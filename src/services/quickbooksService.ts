import { db } from '../db/storage';
import { Product, User } from '../types';
import { generateUUID } from '../utils/crypto';

export class QuickBooksService {
  /**
   * Sample IIF format for QuickBooks Item Lists.
   */
  public static generateSampleIIF(): string {
    return `!INVITEM\tNAME\tINVITEMTYPE\tDESC\tPRICE\tCOST\tQTYONHAND\tREORDERPOINT
INVITEM\tHammer 16oz\tPART\tSteel Claw Hammer\t14.99\t7.50\t25\t5
INVITEM\tCordless Drill 18V\tPART\t18V Lithium Drill Kit\t89.99\t50.00\t12\t3
INVITEM\tMeasuring Tape 8m\tPART\tHeavy Duty Rubber Grip Tape\t8.50\t4.00\t40\t10
INVITEM\tWood Screws #8x2\tPART\tBox of 100 Screws\t6.99\t2.80\t50\t15
INVITEM\tLED Work Light\tPART\tRechargeable 1000lm Floodlight\t24.99\t12.00\t18\t4`;
  }

  /**
   * Parse QuickBooks IIF item list text and import products into local DB.
   */
  public static parseAndImportIIF(
    iifText: string,
    currentUser: User
  ): { success: boolean; itemsImported: number; skipped: number; error?: string } {
    if (currentUser.role !== 'ADMIN') {
      return { success: false, itemsImported: 0, skipped: 0, error: 'Only administrators can import QuickBooks files.' };
    }

    try {
      const lines = iifText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        return { success: false, itemsImported: 0, skipped: 0, error: 'Empty file provided.' };
      }

      let headerFound = false;
      let nameIdx = 1;
      let priceIdx = 4;
      let costIdx = 5;
      let qtyIdx = 6;
      let skuIdx = 1;

      const existingProducts = db.getProducts();
      const defaultShopId = db.getShops()[0]?.id || 'shop-1';
      let imported = 0;
      let skipped = 0;

      for (const line of lines) {
        if (line.startsWith('!INVITEM')) {
          headerFound = true;
          const headers = line.split('\t');
          nameIdx = headers.indexOf('DESC') !== -1 ? headers.indexOf('DESC') : headers.indexOf('NAME');
          priceIdx = headers.indexOf('PRICE') !== -1 ? headers.indexOf('PRICE') : 4;
          costIdx = headers.indexOf('COST') !== -1 ? headers.indexOf('COST') : 5;
          qtyIdx = headers.indexOf('QTYONHAND') !== -1 ? headers.indexOf('QTYONHAND') : 6;
          skuIdx = headers.indexOf('NAME') !== -1 ? headers.indexOf('NAME') : 1;
          continue;
        }

        if (!line.startsWith('INVITEM') && headerFound) {
          continue;
        }

        const parts = line.split('\t');
        if (parts.length < 3) continue;

        const name = parts[nameIdx] || parts[1];
        if (!name) {
          skipped++;
          continue;
        }

        const sku = parts[skuIdx] || `QB-${Date.now().toString().slice(-4)}-${imported + 1}`;
        const price = parseFloat(parts[priceIdx]) || 10;
        const cost = parseFloat(parts[costIdx]) || 5;
        const qty = parseInt(parts[qtyIdx], 10) || 10;

        const exists = existingProducts.some(p => p.sku.toLowerCase() === sku.toLowerCase());
        if (exists) {
          skipped++;
          continue;
        }

        const newProd: Product = {
          id: generateUUID(),
          shopId: defaultShopId,
          name,
          sku,
          barcode: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          categoryId: 'cat-electronics',
          sellingPrice: price,
          purchasePrice: cost,
          currentStock: qty,
          minStock: 5,
          unit: 'pcs',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        existingProducts.unshift(newProd);
        imported++;
      }

      if (imported > 0) {
        db.saveProducts(existingProducts);

        db.addAuditLog({
          id: generateUUID(),
          userId: currentUser.id,
          userName: currentUser.name,
          action: 'IMPORT_QUICKBOOKS',
          details: `Imported ${imported} products via QuickBooks IIF format (${skipped} skipped/duplicates).`,
          entityType: 'PRODUCT',
          timestamp: new Date().toISOString(),
        });
      }

      return {
        success: true,
        itemsImported: imported,
        skipped,
      };
    } catch (err: any) {
      return {
        success: false,
        itemsImported: 0,
        skipped: 0,
        error: `Failed to parse QuickBooks IIF file: ${err.message}`,
      };
    }
  }
}
