// src/services/excelExportService.ts
import * as XLSX from 'xlsx';
import { db } from '../db/storage';
import { Product } from '../types';

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
}
