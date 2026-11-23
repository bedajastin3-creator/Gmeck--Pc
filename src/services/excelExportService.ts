// src/services/excelExportService.ts
import * as XLSX from 'xlsx';
import { db } from '../db/storage';
import type { BusinessSettings, Product } from '../types';
import type { InventoryExportMeta, InventoryExportRow } from '../utils/pdfExport';

export interface ExcelExportResult {
  success: boolean;
  fileName: string;
  rowCount?: number;
  error?: string;
}

// These 4 headers match ExcelImportService.detectHeaders() exactly
const IMPORT_HEADERS = ['Product Name', 'Buying Price', 'Selling Price', 'Quantity'];

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function autoColWidths(rows: any[][]): { wch: number }[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, idx) => {
      const len = String(cell ?? '').length;
      widths[idx] = Math.max(widths[idx] || 0, len);
    });
  }
  return widths.map(w => ({ wch: Math.min(w + 2, 45) }));
}

function productToRow(p: Product): (string | number)[] {
  return [
    p.name || '',
    p.purchasePrice ?? 0,
    p.sellingPrice ?? 0,
    p.currentStock ?? 0,
  ];
}

export class ExcelExportService {
  public static exportAllProducts(shopId: string): ExcelExportResult {
    try {
      if (!shopId) {
        return { success: false, fileName: '', error: 'Shop ID is required.' };
      }

      const all = db.getProducts();
      const filtered = all.filter(p => p.shopId === shopId);

      if (filtered.length === 0) {
        return { success: false, fileName: '', error: 'No products found for this shop.' };
      }

      const aoa: any[][] = [IMPORT_HEADERS, ...filtered.map(productToRow)];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = autoColWidths(aoa);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Products');

      const fileName = `products_${todayStamp()}.xlsx`;
      XLSX.writeFile(wb, fileName);

      return { success: true, fileName, rowCount: filtered.length };
    } catch (err: any) {
      return { success: false, fileName: '', error: err.message || 'Export failed.' };
    }
  }

  public static exportStoreProducts(
    store: import('../types').Store,
    customProducts?: Product[]
  ): ExcelExportResult {
    try {
      const sourceList = customProducts ?? db.getProducts();
      const filtered = sourceList.filter(p => {
        if (p.shopId !== store.shopId) return false;
        const qty =
          p.storeStocks && p.storeStocks[store.id] !== undefined
            ? Number(p.storeStocks[store.id] || 0)
            : store.isShopFloor
              ? Number(p.currentStock || 0)
              : p.storeId === store.id
                ? Number(p.storeStock || 0)
                : 0;
        return qty > 0 || Boolean(p.storeDetails?.[store.id]);
      });

      if (filtered.length === 0) {
        return {
          success: false,
          fileName: '',
          error: `No products found in ${store.name}.`,
        };
      }

      const aoa: any[][] = [
        IMPORT_HEADERS,
        ...filtered.map(p => {
          const qty =
            p.storeStocks && p.storeStocks[store.id] !== undefined
              ? Number(p.storeStocks[store.id] || 0)
              : store.isShopFloor
                ? Number(p.currentStock || 0)
                : Number(p.storeStock || 0);
          return [
            p.name || '',
            p.purchasePrice ?? 0,
            p.sellingPrice ?? 0,
            qty,
          ];
        }),
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = autoColWidths(aoa);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Store Products');

      const safeName = (store.name || 'store')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const fileName = `${safeName || 'store'}_inventory_${todayStamp()}.xlsx`;
      XLSX.writeFile(wb, fileName);

      return { success: true, fileName, rowCount: filtered.length };
    } catch (err: any) {
      return { success: false, fileName: '', error: err.message || 'Store export failed.' };
    }
  }

  public static exportCombinedStoresProducts(
    stores: import('../types').Store[],
    products: Product[]
  ): ExcelExportResult {
    try {
      if (!products || products.length === 0) {
        return { success: false, fileName: '', error: 'No products found to export.' };
      }

      const shopsById = new Map(db.getShops().map(s => [s.id, s.name]));
      const headers = [
        'Store Name',
        'Shop',
        'Product Name',
        'Variation',
        'SKU',
        'Buying Price',
        'Selling Price',
        'Quantity',
      ];
      const rows: any[][] = [];

      for (const st of stores) {
        for (const p of products) {
          if (p.shopId !== st.shopId) continue;
          const qty =
            p.storeStocks && p.storeStocks[st.id] !== undefined
              ? Number(p.storeStocks[st.id] || 0)
              : st.isShopFloor
                ? Number(p.currentStock || 0)
                : p.storeId === st.id
                  ? Number(p.storeStock || 0)
                  : 0;
          if (qty <= 0 && !p.storeDetails?.[st.id]) continue;
          rows.push([
            st.name,
            shopsById.get(st.shopId) || '',
            p.name || '',
            p.variation || '',
            p.sku || '',
            p.purchasePrice ?? 0,
            p.sellingPrice ?? 0,
            qty,
          ]);
        }
      }

      if (rows.length === 0) {
        return { success: false, fileName: '', error: 'No stocked store products found.' };
      }

      const aoa: any[][] = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = autoColWidths(aoa);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'All Stores Inventory');

      const fileName = `all_stores_inventory_${todayStamp()}.xlsx`;
      XLSX.writeFile(wb, fileName);

      return { success: true, fileName, rowCount: rows.length };
    } catch (err: any) {
      return { success: false, fileName: '', error: err.message || 'Export failed.' };
    }
  }

  public static async exportInventoryReport(
    rows: InventoryExportRow[],
    settings: BusinessSettings,
    meta: InventoryExportMeta
  ): Promise<ExcelExportResult> {
    try {
      if (!rows || rows.length === 0) {
        return { success: false, fileName: '', error: 'No inventory items to export.' };
      }

      const cur = settings.currencySymbol || 'TSh';
      const headers = [
        'Shop',
        'Product Name',
        'Variation',
        'SKU',
        'Unit',
        'Scope',
        'Shop Qty',
        'Store Qty',
        'Active Qty',
        'Min Stock',
        `Buying Price (${cur})`,
        `Selling Price (${cur})`,
        `Buy Value (${cur})`,
        `Sell Value (${cur})`,
        `Potential Profit (${cur})`,
        'Warehouse Breakdown',
        'Status',
      ];

      const bodyRows = rows.map(r => [
        r.shopName,
        r.productName,
        r.variation || '',
        r.sku,
        r.unit,
        r.rowScope,
        r.shopQty,
        r.storeQty,
        r.activeQty,
        r.minStock,
        r.purchasePrice,
        r.sellingPrice,
        r.buyValue,
        r.sellValue,
        r.potentialProfit,
        r.storeBreakdown || '',
        r.status,
      ]);

      const totalActive = rows.reduce((s, r) => s + r.activeQty, 0);
      const totalBuy = Number(rows.reduce((s, r) => s + r.buyValue, 0).toFixed(2));
      const totalSell = Number(rows.reduce((s, r) => s + r.sellValue, 0).toFixed(2));
      const totalProfit = Number((totalSell - totalBuy).toFixed(2));

      const totalsRow = [
        'TOTAL',
        `${rows.length} SKU(s)`,
        '',
        '',
        '',
        meta.scope,
        rows.reduce((s, r) => s + r.shopQty, 0),
        rows.reduce((s, r) => s + r.storeQty, 0),
        totalActive,
        '',
        '',
        '',
        totalBuy,
        totalSell,
        totalProfit,
        '',
        '',
      ];

      const aoa: any[][] = [headers, ...bodyRows, totalsRow];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = autoColWidths(aoa);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Inventory');

      const safeShop = (meta.shopLabel || 'inventory')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const fileName = `inventory_${meta.scope.toLowerCase()}_${safeShop || 'all'}_${todayStamp()}.xlsx`;
      XLSX.writeFile(wb, fileName);

      return { success: true, fileName, rowCount: rows.length };
    } catch (err: any) {
      return { success: false, fileName: '', error: err?.message || 'Inventory Excel export failed.' };
    }
  }
}
