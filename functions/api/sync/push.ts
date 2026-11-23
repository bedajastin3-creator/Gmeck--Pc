// functions/api/sync/push.ts

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Device-ID',
  'Access-Control-Max-Age': '86400',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Sync push endpoint. Use POST method.',
    }),
    {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    }
  );
}

export async function onRequestPost(context: any) {
  const { request, env } = context;

  try {
    const { deviceId, operations } = await request.json();

    console.log('[Push] Received operations:', operations?.length || 0);

    if (!operations || !Array.isArray(operations)) {
      return jsonResponse(
        { error: 'Invalid sync payload' },
        400
      );
    }

    const results: any[] = [];
    const errors: any[] = [];

    for (const op of operations) {
      console.log('[Push] Processing:', op.operation, 'ID:', op.entityId);

      try {
        const result = await processOperation(env.DB, op);
        results.push({ id: op.id, success: true, ...result });
        console.log('[Push] Success:', op.operation);
      } catch (error: any) {
        console.error('[Push] Error:', op.operation, error.message);
        errors.push({
          id: op.id,
          operation: op.operation,
          entityId: op.entityId,
          error: error.message,
        });
      }
    }

    // 207 = partial, 400 = all failed, 200 = all ok.
    const status =
      errors.length === 0
        ? 200
        : results.length > 0
        ? 207
        : 400;

    return jsonResponse(
      {
        success: errors.length === 0,
        processedCount: results.length,
        failedCount: errors.length,
        results,
        errors,
      },
      status
    );
  } catch (error: any) {
    console.error('[Push] Request error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

function jsonResponse(body: any, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function processOperation(db: any, op: any) {
  const { operation, payload } = op;

  switch (operation) {
    case 'CREATE_SHOP':
    case 'UPDATE_SHOP':
    case 'TOGGLE_SHOP_STATUS':
      await upsertShop(db, payload);
      break;
    case 'DELETE_SHOP':
      await deleteShop(db, payload);
      break;

    case 'CREATE_PRODUCT':
    case 'UPDATE_PRODUCT':
    case 'TOGGLE_PRODUCT_STATUS':
      await upsertProduct(db, payload, operation);
      break;
    case 'DELETE_PRODUCT':
      await deleteProduct(db, payload);
      break;

    case 'CREATE_CATEGORY':
    case 'UPDATE_CATEGORY':
      await upsertCategory(db, payload);
      break;

    case 'CREATE_SALE':
      await createSale(db, payload);
      break;
    case 'UPDATE_SALE':
      await updateSale(db, payload);
      break;
    case 'VOID_SALE':
      await voidSale(db, payload);
      break;

    case 'CREATE_PURCHASE':
      await createPurchase(db, payload);
      break;
    case 'UPDATE_PURCHASE':
      await updatePurchase(db, payload);
      break;
    case 'DELETE_PURCHASE':
      await deletePurchase(db, payload);
      break;
    case 'CREATE_PURCHASE_RETURN':
      await createPurchaseReturn(db, payload);
      break;

    case 'CREATE_EXPENSE':
      await createExpense(db, payload);
      break;

    case 'CREATE_SELLER':
    case 'UPDATE_SELLER':
      await upsertUser(db, payload);
      break;
    case 'DELETE_SELLER':
      await deleteSeller(db, payload);
      break;

    case 'STOCK_ADJUSTMENT':
      await recordStockAdjustment(db, payload);
      break;

    case 'UPDATE_SETTINGS':
      await updateSettings(db, payload);
      break;

    case 'CREATE_DEBT':
      await createDebt(db, payload);
      break;
    case 'UPDATE_DEBT':
      await updateDebt(db, payload);
      break;
    case 'DELETE_DEBT':
      await deleteDebt(db, payload);
      break;

    case 'CREATE_SALE_EDIT_REQUEST':
      await createSaleEditRequest(db, payload);
      break;
    case 'REVIEW_SALE_EDIT_REQUEST':
      await reviewSaleEditRequest(db, payload);
      break;

    // ── STORE OPERATIONS ──
    case 'CREATE_STORE':
    case 'UPDATE_STORE':
      await upsertStore(db, payload);
      break;
    case 'DELETE_STORE':
      await deleteStore(db, payload);
      break;
    case 'TRANSFER_STORE_TO_SHOP':
      await transferStoreToShop(db, payload);
      break;
    case 'UPSERT_STOCK_TRANSFER':
      await upsertStockTransfer(db, payload);
      break;
    case 'DELETE_STOCK_TRANSFER':
      await deleteStockTransfer(db, payload);
      break;

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }

  return { entityType: op.entityType, entityId: op.entityId };
}

// ──────────────────────────────────────────────────────────
// DELETE HANDLERS
// ──────────────────────────────────────────────────────────

async function deleteShop(db: any, payload: any) {
  // ORDER MATTERS: children first, shops LAST.
  await db
    .prepare(
      'DELETE FROM product_images WHERE product_id IN (SELECT id FROM products WHERE shop_id = ?)'
    )
    .bind(payload.id)
    .run();
  await db
    .prepare('DELETE FROM inventory_movements WHERE shop_id = ?')
    .bind(payload.id)
    .run();
  try {
    await db
      .prepare(
        'DELETE FROM purchase_return_items WHERE return_id IN (SELECT id FROM purchase_returns WHERE shop_id = ?)'
      )
      .bind(payload.id)
      .run();
    await db
      .prepare('DELETE FROM purchase_returns WHERE shop_id = ?')
      .bind(payload.id)
      .run();
  } catch {
    // Ignore if purchase_returns tables are absent
  }
  await db
    .prepare(
      'DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE shop_id = ?)'
    )
    .bind(payload.id)
    .run();
  await db
    .prepare('DELETE FROM purchases WHERE shop_id = ?')
    .bind(payload.id)
    .run();
  try {
    await db
      .prepare(
        'DELETE FROM sale_edit_requests WHERE sale_id IN (SELECT id FROM sales WHERE shop_id = ?)'
      )
      .bind(payload.id)
      .run();
  } catch {
    // Ignore if sale_edit_requests table is absent
  }
  await db
    .prepare(
      'DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE shop_id = ?)'
    )
    .bind(payload.id)
    .run();
  await db.prepare('DELETE FROM sales WHERE shop_id = ?').bind(payload.id).run();
  await db
    .prepare('DELETE FROM products WHERE shop_id = ?')
    .bind(payload.id)
    .run();
  await db
    .prepare('DELETE FROM categories WHERE shop_id = ?')
    .bind(payload.id)
    .run();
  await db
    .prepare('DELETE FROM expenses WHERE shop_id = ?')
    .bind(payload.id)
    .run();
  try {
    await db
      .prepare(
        'DELETE FROM debt_payments WHERE debt_id IN (SELECT id FROM debts WHERE shop_id = ?)'
      )
      .bind(payload.id)
      .run();
  } catch {
    // Ignore if debt_payments table is absent
  }
  await db
    .prepare('DELETE FROM debts WHERE shop_id = ?')
    .bind(payload.id)
    .run();
  // Stores BEFORE shops (FK!)
  await db.prepare('DELETE FROM stores WHERE shop_id = ?').bind(payload.id).run();
  // Shops LAST
  await db.prepare('DELETE FROM shops WHERE id = ?').bind(payload.id).run();
}

async function deleteProduct(db: any, payload: any) {
  await db
    .prepare('DELETE FROM product_images WHERE product_id = ?')
    .bind(payload.id)
    .run();
  await db
    .prepare('DELETE FROM inventory_movements WHERE product_id = ?')
    .bind(payload.id)
    .run();
  await db
    .prepare('DELETE FROM purchase_items WHERE product_id = ?')
    .bind(payload.id)
    .run();
  await db
    .prepare('DELETE FROM sale_items WHERE product_id = ?')
    .bind(payload.id)
    .run();
  await db.prepare('DELETE FROM products WHERE id = ?').bind(payload.id).run();
}

async function deleteSeller(db: any, payload: any) {
  await db
    .prepare('DELETE FROM users WHERE id = ? AND role = ?')
    .bind(payload.id, 'SELLER')
    .run();
}

async function deleteDebt(db: any, payload: any) {
  await db
    .prepare('DELETE FROM debt_payments WHERE debt_id = ?')
    .bind(payload.id)
    .run();
  await db.prepare('DELETE FROM debts WHERE id = ?').bind(payload.id).run();
}

async function deleteStore(db: any, payload: any) {
  if (!payload?.id) {
    throw new Error('deleteStore: missing store id');
  }
  await db
    .prepare('UPDATE inventory_movements SET store_id = NULL WHERE store_id = ?')
    .bind(payload.id)
    .run();
  await db.prepare('DELETE FROM stores WHERE id = ?').bind(payload.id).run();
}

// ──────────────────────────────────────────────────────────
// UPSERT HANDLERS
// ──────────────────────────────────────────────────────────

async function upsertShop(db: any, shop: any) {
  await db
    .prepare(
      `
    INSERT INTO shops (id, name, code, description, address, phone, status, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      code = excluded.code,
      description = excluded.description,
      address = excluded.address,
      phone = excluded.phone,
      status = excluded.status,
      color = excluded.color,
      updated_at = excluded.updated_at
  `
    )
    .bind(
      shop.id,
      shop.name,
      shop.code || null,
      shop.description || null,
      shop.address || null,
      shop.phone || null,
      shop.status || 'ACTIVE',
      shop.color || null,
      shop.createdAt || new Date().toISOString(),
      shop.updatedAt || new Date().toISOString()
    )
    .run();
}

async function upsertStore(db: any, store: any) {
  const shopId = store?.shopId || store?.shop_id;
  if (!store?.id) {
    throw new Error('upsertStore: missing store.id');
  }
  if (!shopId) {
    throw new Error('upsertStore: missing store.shopId');
  }

  // Explicit FK pre-check so errors surface with a clear message
  const shop = await db
    .prepare('SELECT id FROM shops WHERE id = ?')
    .bind(shopId)
    .first();

  if (!shop) {
    throw new Error(
      `Cannot upsert store "${store.name}" (id=${store.id}): shop_id "${shopId}" does not exist in DB. Push the shop before the store.`
    );
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `
    INSERT INTO stores (id, shop_id, name, location, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      shop_id = excluded.shop_id,
      name = excluded.name,
      location = excluded.location,
      status = excluded.status,
      updated_at = excluded.updated_at
  `
    )
    .bind(
      store.id,
      shopId,
      store.name,
      store.location || null,
      store.status || 'ACTIVE',
      store.createdAt || store.created_at || now,
      store.updatedAt || store.updated_at || now
    )
    .run();
}

let productColumnsChecked = false;
let hasProductStoreColumns = false;

async function ensureProductStoreColumns(db: any): Promise<boolean> {
  if (productColumnsChecked) return hasProductStoreColumns;
  productColumnsChecked = true;
  try {
    const info = await db.prepare('PRAGMA table_info(products)').all();
    const existingCols = new Set(
      (info?.results || []).map((c: any) => String(c.name || '').toLowerCase())
    );
    const needed = [
      { name: 'store_id', type: 'TEXT' },
      { name: 'store_stocks', type: 'TEXT' },
      { name: 'store_details', type: 'TEXT' },
      { name: 'variation', type: 'TEXT' },
      { name: 'custom_fields', type: 'TEXT' },
    ];
    for (const col of needed) {
      if (!existingCols.has(col.name)) {
        try {
          await db
            .prepare(`ALTER TABLE products ADD COLUMN ${col.name} ${col.type}`)
            .run();
          existingCols.add(col.name);
        } catch {
          // Ignore if ALTER TABLE is restricted or concurrent
        }
      }
    }
    hasProductStoreColumns =
      existingCols.has('store_stocks') && existingCols.has('store_id');
  } catch {
    hasProductStoreColumns = false;
  }
  return hasProductStoreColumns;
}

async function upsertProduct(db: any, product: any, operation?: string) {
  const hasExplicitStoreStock =
    product.storeStock !== undefined && product.storeStock !== null;
  const currentStock =
    product.storeId && !hasExplicitStoreStock
      ? 0
      : Number(product.currentStock || 0);
  const storeStock =
    product.storeId && !hasExplicitStoreStock
      ? Number(product.currentStock ?? 0)
      : Number(product.storeStock ?? 0);

  await db
    .prepare(
      `
    INSERT INTO products (
      id, shop_id, name, sku, barcode, category_id,
      selling_price, proposed_selling_price, purchase_price,
      current_stock, store_stock, min_stock, unit, status, image_url, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      shop_id = excluded.shop_id,
      name = excluded.name,
      sku = excluded.sku,
      barcode = excluded.barcode,
      category_id = excluded.category_id,
      selling_price = excluded.selling_price,
      proposed_selling_price = excluded.proposed_selling_price,
      purchase_price = excluded.purchase_price,
      current_stock = excluded.current_stock,
      store_stock = excluded.store_stock,
      min_stock = excluded.min_stock,
      unit = excluded.unit,
      status = excluded.status,
      image_url = excluded.image_url,
      updated_at = excluded.updated_at
  `
    )
    .bind(
      product.id,
      product.shopId,
      product.name,
      product.sku,
      product.barcode || null,
      product.categoryId || '',
      product.sellingPrice || 0,
      product.proposedSellingPrice || null,
      product.purchasePrice || 0,
      currentStock,
      storeStock,
      product.minStock !== undefined && product.minStock !== null ? Number(product.minStock) : 0,
      product.unit || 'pcs',
      product.status || 'ACTIVE',
      product.imageUrl || product.image_url || null,
      product.createdAt || new Date().toISOString(),
      product.updatedAt || new Date().toISOString()
    )
    .run();

  // Safely persist per-store stock breakdown & metadata when columns exist / can be added
  try {
    const canPersistStoreCols = await ensureProductStoreColumns(db);
    if (canPersistStoreCols) {
      const storeIdVal = product.storeId || product.store_id || null;
      const storeStocksJson = product.storeStocks
        ? JSON.stringify(product.storeStocks)
        : product.store_stocks
          ? typeof product.store_stocks === 'string'
            ? product.store_stocks
            : JSON.stringify(product.store_stocks)
          : null;
      const storeDetailsJson = product.storeDetails
        ? JSON.stringify(product.storeDetails)
        : product.store_details
          ? typeof product.store_details === 'string'
            ? product.store_details
            : JSON.stringify(product.store_details)
          : null;
      const variationVal = product.variation || null;
      const customFieldsJson = product.customFields
        ? JSON.stringify(product.customFields)
        : product.custom_fields
          ? typeof product.custom_fields === 'string'
            ? product.custom_fields
            : JSON.stringify(product.custom_fields)
          : null;

      await db
        .prepare(
          `UPDATE products
           SET store_id = ?, store_stocks = ?, store_details = ?, variation = ?, custom_fields = ?
           WHERE id = ?`
        )
        .bind(
          storeIdVal,
          storeStocksJson,
          storeDetailsJson,
          variationVal,
          customFieldsJson,
          product.id
        )
        .run();
    }
  } catch (metaErr: any) {
    console.warn('[Push] Optional store metadata update skipped:', metaErr?.message || metaErr);
  }

  if (
    operation === 'CREATE_PRODUCT' &&
    product.storeId &&
    currentStock === 0 &&
    storeStock > 0
  ) {
    await db
      .prepare(
        `
      INSERT INTO inventory_movements (
        id, shop_id, shop_name, product_id, product_name, store_id,
        previous_qty, change_qty, new_qty, type, reason, 
        user_id, user_name, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .bind(
        crypto.randomUUID(),
        product.shopId,
        null,
        product.id,
        product.name,
        product.storeId,
        0,
        storeStock,
        storeStock,
        'INITIAL_STOCK',
        'Product added directly to store',
        product.createdByUserId || 'system',
        'System',
        new Date().toISOString()
      )
      .run();
  }

  if (
    product.images &&
    Array.isArray(product.images) &&
    product.images.length > 0
  ) {
    for (let i = 0; i < product.images.length; i++) {
      const img = product.images[i];
      await db
        .prepare(
          `
        INSERT INTO product_images (
          image_id, product_id, image_order, version, r2_key,
          filename, mime_type, file_size, width, height, hash,
          sync_status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(image_id) DO UPDATE SET
          image_order = excluded.image_order,
          version = excluded.version,
          r2_key = excluded.r2_key,
          filename = excluded.filename,
          mime_type = excluded.mime_type,
          file_size = excluded.file_size,
          sync_status = excluded.sync_status,
          updated_at = excluded.updated_at
      `
        )
        .bind(
          img.imageId || crypto.randomUUID(),
          product.id,
          img.imageOrder !== undefined ? img.imageOrder : i,
          img.version || 1,
          img.dataUrl || img.thumbnailUrl || img.r2_key || null,
          img.filename || null,
          img.mimeType || 'image/jpeg',
          img.fileSize || 0,
          img.width || null,
          img.height || null,
          img.hash || null,
          img.syncStatus || 'SYNCED',
          img.createdAt || new Date().toISOString(),
          img.updatedAt || new Date().toISOString()
        )
        .run();
    }
  }
}

async function upsertCategory(db: any, category: any) {
  await db
    .prepare(
      `
    INSERT INTO categories (id, shop_id, name, icon, color, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      shop_id = excluded.shop_id,
      name = excluded.name,
      icon = excluded.icon,
      color = excluded.color,
      status = excluded.status,
      updated_at = excluded.updated_at
  `
    )
    .bind(
      category.id,
      category.shopId,
      category.name,
      category.icon || null,
      category.color || null,
      category.status || 'ACTIVE',
      category.createdAt || new Date().toISOString(),
      category.updatedAt || new Date().toISOString()
    )
    .run();
}

// ──────────────────────────────────────────────────────────
// SALES
// ──────────────────────────────────────────────────────────

let salesAssistantColChecked = false;
let hasSalesAssistantCol = false;

async function ensureSalesAssistantColumn(db: any): Promise<boolean> {
  if (salesAssistantColChecked) return hasSalesAssistantCol;
  salesAssistantColChecked = true;
  try {
    const info = await db.prepare('PRAGMA table_info(sales)').all();
    const cols = new Set(
      (info?.results || []).map((c: any) => String(c.name || '').toLowerCase())
    );
    if (!cols.has('assistant_name')) {
      await db.prepare('ALTER TABLE sales ADD COLUMN assistant_name TEXT').run();
    }
    hasSalesAssistantCol = true;
  } catch {
    hasSalesAssistantCol = false;
  }
  return hasSalesAssistantCol;
}

async function createSale(db: any, sale: any) {
  const now = new Date().toISOString();
  const assistantColOk = await ensureSalesAssistantColumn(db);
  if (assistantColOk) {
    await db
      .prepare(
        `
      INSERT INTO sales (
        id, receipt_number, shop_id, shop_name, seller_id, seller_name, assistant_name,
        subtotal, discount, tax, total, cost_of_goods, gross_profit,
        payment_method, amount_received, change, status, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `
      )
      .bind(
        sale.id,
        sale.receiptNumber,
        sale.shopId,
        sale.shopName || null,
        sale.sellerId,
        sale.sellerName,
        sale.assistantName || null,
        sale.subtotal || 0,
        sale.discount || 0,
        sale.tax || 0,
        sale.total || 0,
        sale.costOfGoods || 0,
        sale.grossProfit || 0,
        sale.paymentMethod,
        sale.amountReceived || 0,
        sale.change || 0,
        sale.status || 'COMPLETED',
        sale.notes || null,
        sale.createdAt || now,
        now
      )
      .run();
  } else {
    await db
      .prepare(
        `
      INSERT INTO sales (
        id, receipt_number, shop_id, shop_name, seller_id, seller_name,
        subtotal, discount, tax, total, cost_of_goods, gross_profit,
        payment_method, amount_received, change, status, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `
      )
      .bind(
        sale.id,
        sale.receiptNumber,
        sale.shopId,
        sale.shopName || null,
        sale.sellerId,
        sale.sellerName,
        sale.subtotal || 0,
        sale.discount || 0,
        sale.tax || 0,
        sale.total || 0,
        sale.costOfGoods || 0,
        sale.grossProfit || 0,
        sale.paymentMethod,
        sale.amountReceived || 0,
        sale.change || 0,
        sale.status || 'COMPLETED',
        sale.notes || null,
        sale.createdAt || now,
        now
      )
      .run();
  }

  for (const item of sale.items || []) {
    await db
      .prepare(
        `
      INSERT INTO sale_items (
        id, sale_id, shop_id, product_id, product_name, sku,
        unit_price, purchase_price, quantity, discount, total,
        reference_price, reference_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `
      )
      .bind(
        item.id || crypto.randomUUID(),
        sale.id,
        item.shopId || sale.shopId,
        item.productId,
        item.productName,
        item.sku,
        item.unitPrice || 0,
        item.purchasePrice || 0,
        item.quantity || 0,
        item.discount || 0,
        item.total || 0,
        item.referencePrice ?? null,
        item.referenceType ?? null
      )
      .run();

    await db
      .prepare(
        `UPDATE products SET current_stock = current_stock - ?, updated_at = ? WHERE id = ?`
      )
      .bind(item.quantity || 0, new Date().toISOString(), item.productId)
      .run();
  }
}

async function updateSale(db: any, sale: any) {
  console.log('[updateSale] Updating sale:', sale.id);

  const oldSaleItems = await db
    .prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?')
    .bind(sale.id)
    .all();

  if (oldSaleItems.results) {
    for (const oldItem of oldSaleItems.results) {
      await db
        .prepare(
          `UPDATE products SET current_stock = current_stock + ?, updated_at = ? WHERE id = ?`
        )
        .bind(
          oldItem.quantity || 0,
          new Date().toISOString(),
          oldItem.product_id
        )
        .run();
    }
  }

  await db.prepare('DELETE FROM sale_items WHERE sale_id = ?').bind(sale.id).run();

  await db
    .prepare(
      `
    UPDATE sales SET
      subtotal = ?, discount = ?, total = ?, cost_of_goods = ?, gross_profit = ?,
      amount_received = ?, change = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `
    )
    .bind(
      sale.subtotal || 0,
      sale.discount || 0,
      sale.total || 0,
      sale.costOfGoods || 0,
      sale.grossProfit || 0,
      sale.amountReceived || 0,
      sale.change || 0,
      sale.notes || null,
      new Date().toISOString(),
      sale.id
    )
    .run();

  for (const item of sale.items || []) {
    await db
      .prepare(
        `
      INSERT INTO sale_items (
        id, sale_id, shop_id, product_id, product_name, sku,
        unit_price, purchase_price, quantity, discount, total,
        reference_price, reference_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `
      )
      .bind(
        item.id || crypto.randomUUID(),
        sale.id,
        item.shopId || sale.shopId,
        item.productId,
        item.productName,
        item.sku,
        item.unitPrice || 0,
        item.purchasePrice || 0,
        item.quantity || 0,
        item.discount || 0,
        item.total || 0,
        item.referencePrice ?? null,
        item.referenceType ?? null
      )
      .run();

    await db
      .prepare(
        `UPDATE products SET current_stock = current_stock - ?, updated_at = ? WHERE id = ?`
      )
      .bind(item.quantity || 0, new Date().toISOString(), item.productId)
      .run();
  }
}

async function voidSale(db: any, payload: any) {
  const saleId = payload.saleId || payload.id;

  const saleItems = await db
    .prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?')
    .bind(saleId)
    .all();

  if (saleItems.results) {
    for (const item of saleItems.results) {
      await db
        .prepare(
          `UPDATE products SET current_stock = current_stock + ?, updated_at = ? WHERE id = ?`
        )
        .bind(item.quantity || 0, new Date().toISOString(), item.product_id)
        .run();
    }
  }

  await db
    .prepare(
      `
    UPDATE sales SET
      status = 'VOIDED', void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ?
    WHERE id = ?
  `
    )
    .bind(
      payload.voidReason || '',
      payload.voidedAt || new Date().toISOString(),
      payload.voidedBy || '',
      new Date().toISOString(),
      saleId
    )
    .run();
}

// ──────────────────────────────────────────────────────────
// PURCHASES
// ──────────────────────────────────────────────────────────

async function createPurchase(db: any, purchase: any) {
  const nowIso = new Date().toISOString();
  const createdAt = purchase.createdAt || nowIso;
  // Always use server write time for updated_at so incremental pulls pick up backdated purchases
  const updatedAt = nowIso;

  try {
    await db
      .prepare(
        `
      INSERT INTO purchases (
        id, purchase_number, shop_id, shop_name, store_id, store_name,
        supplier_name, supplier_phone, date,
        total_amount, payment_status, notes, invoice_number,
        created_by_user_id, created_by_name, created_at, updated_at, last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `
      )
      .bind(
        purchase.id,
        purchase.purchaseNumber,
        purchase.shopId,
        purchase.shopName || null,
        purchase.storeId || null,
        purchase.storeName || null,
        purchase.supplierName,
        purchase.supplierPhone || null,
        purchase.date || nowIso.slice(0, 10),
        purchase.totalAmount || 0,
        purchase.paymentStatus || 'PAID',
        purchase.notes || null,
        purchase.invoiceNumber || null,
        purchase.createdByUserId,
        purchase.createdByName,
        createdAt,
        updatedAt,
        nowIso
      )
      .run();
  } catch {
    try {
      // Fallback if supplier_phone column has not been added to D1 yet
      await db
        .prepare(
          `
        INSERT INTO purchases (
          id, purchase_number, shop_id, shop_name, store_id, store_name, supplier_name, date,
          total_amount, payment_status, notes, invoice_number,
          created_by_user_id, created_by_name, created_at, updated_at, last_synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `
        )
        .bind(
          purchase.id,
          purchase.purchaseNumber,
          purchase.shopId,
          purchase.shopName || null,
          purchase.storeId || null,
          purchase.storeName || null,
          purchase.supplierName,
          purchase.date || nowIso.slice(0, 10),
          purchase.totalAmount || 0,
          purchase.paymentStatus || 'PAID',
          purchase.notes || null,
          purchase.invoiceNumber || null,
          purchase.createdByUserId,
          purchase.createdByName,
          createdAt,
          updatedAt,
          nowIso
        )
        .run();
    } catch {
      // Legacy fallback if optional store_id/store_name/updated_at columns are not present
      await db
        .prepare(
          `
        INSERT INTO purchases (
          id, purchase_number, shop_id, shop_name, supplier_name, date,
          total_amount, payment_status, notes, invoice_number,
          created_by_user_id, created_by_name, created_at, last_synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `
        )
        .bind(
          purchase.id,
          purchase.purchaseNumber,
          purchase.shopId,
          purchase.shopName || null,
          purchase.supplierName,
          purchase.date || nowIso.slice(0, 10),
          purchase.totalAmount || 0,
          purchase.paymentStatus || 'PAID',
          purchase.notes || null,
          purchase.invoiceNumber || null,
          purchase.createdByUserId,
          purchase.createdByName,
          createdAt,
          nowIso
        )
        .run();
    }
  }

  for (const item of purchase.items || []) {
    await db
      .prepare(
        `
      INSERT INTO purchase_items (id, purchase_id, product_id, product_name, quantity, unit_cost, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `
      )
      .bind(
        item.id || crypto.randomUUID(),
        purchase.id,
        item.productId,
        item.productName,
        item.quantity || 0,
        item.unitCost || 0,
        item.total || 0
      )
      .run();

    const product = await db
      .prepare('SELECT current_stock, store_stock FROM products WHERE id = ?')
      .bind(item.productId)
      .first();

    if (product) {
      const currentStock = Number(product.current_stock) || 0;
      const currentStoreStock = Number(product.store_stock) || 0;
      const newPurchaseQty = Number(item.quantity) || 0;
      const newUnitCost = Number(item.unitCost) || 0;

      const hasSellingPrice =
        item.sellingPrice !== undefined &&
        item.sellingPrice !== null &&
        Number.isFinite(Number(item.sellingPrice)) &&
        Number(item.sellingPrice) >= 0;
      const newSellingPrice = hasSellingPrice
        ? Number(Number(item.sellingPrice).toFixed(2))
        : null;

      let newStock = currentStock;
      let newStoreStock = currentStoreStock;

      if (purchase.storeId) {
        newStoreStock += newPurchaseQty;
        if (hasSellingPrice) {
          await db
            .prepare(
              `UPDATE products SET store_stock = ?, purchase_price = ?, selling_price = ?, updated_at = ? WHERE id = ?`
            )
            .bind(
              newStoreStock,
              Number(newUnitCost.toFixed(2)),
              newSellingPrice,
              new Date().toISOString(),
              item.productId
            )
            .run();
        } else {
          await db
            .prepare(
              `UPDATE products SET store_stock = ?, purchase_price = ?, updated_at = ? WHERE id = ?`
            )
            .bind(
              newStoreStock,
              Number(newUnitCost.toFixed(2)),
              new Date().toISOString(),
              item.productId
            )
            .run();
        }
      } else {
        newStock += newPurchaseQty;
        if (hasSellingPrice) {
          await db
            .prepare(
              `UPDATE products SET current_stock = ?, purchase_price = ?, selling_price = ?, updated_at = ? WHERE id = ?`
            )
            .bind(
              newStock,
              Number(newUnitCost.toFixed(2)),
              newSellingPrice,
              new Date().toISOString(),
              item.productId
            )
            .run();
        } else {
          await db
            .prepare(
              `UPDATE products SET current_stock = ?, purchase_price = ?, updated_at = ? WHERE id = ?`
            )
            .bind(
              newStock,
              Number(newUnitCost.toFixed(2)),
              new Date().toISOString(),
              item.productId
            )
            .run();
        }
      }

      await db
        .prepare(
          `
        INSERT INTO inventory_movements (
          id, shop_id, shop_name, store_id, product_id, product_name,
          previous_qty, change_qty, new_qty, type, reason, cost_value,
          reference_id, user_id, user_name, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `
        )
        .bind(
          crypto.randomUUID(),
          purchase.shopId,
          purchase.shopName || null,
          purchase.storeId || null,
          item.productId,
          item.productName,
          purchase.storeId ? currentStoreStock : currentStock,
          newPurchaseQty,
          purchase.storeId ? newStoreStock : newStock,
          'PURCHASE',
          `Purchase from ${purchase.supplierName}`,
          newUnitCost,
          purchase.id,
          purchase.createdByUserId,
          purchase.createdByName,
          purchase.createdAt || new Date().toISOString()
        )
        .run();
    }
  }
}

async function updatePurchase(db: any, purchase: any) {
  const nowIso = new Date().toISOString();
  const updatedAt = purchase.updatedAt || nowIso;

  let existingStoreId: string | null = null;
  try {
    const existingRow = await db
      .prepare('SELECT store_id FROM purchases WHERE id = ?')
      .bind(purchase.id)
      .first();
    existingStoreId = existingRow?.store_id || null;
  } catch {
    existingStoreId = null;
  }
  const effectiveStoreId = purchase.storeId || existingStoreId;

  const oldPurchase = await db
    .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
    .bind(purchase.id)
    .all();

  if (oldPurchase.results) {
    for (const oldItem of oldPurchase.results) {
      if (effectiveStoreId) {
        await db
          .prepare(
            `UPDATE products SET store_stock = MAX(0, COALESCE(store_stock, 0) - ?), updated_at = ? WHERE id = ?`
          )
          .bind(
            oldItem.quantity || 0,
            nowIso,
            oldItem.product_id
          )
          .run();
      } else {
        await db
          .prepare(
            `UPDATE products SET current_stock = MAX(0, COALESCE(current_stock, 0) - ?), updated_at = ? WHERE id = ?`
          )
          .bind(
            oldItem.quantity || 0,
            nowIso,
            oldItem.product_id
          )
          .run();
      }
    }
  }

  await db
    .prepare('DELETE FROM purchase_items WHERE purchase_id = ?')
    .bind(purchase.id)
    .run();

  try {
    await db
      .prepare(
        `
      UPDATE purchases
      SET supplier_name = ?, supplier_phone = ?, date = COALESCE(?, date),
          created_at = COALESCE(?, created_at),
          invoice_number = ?, payment_status = ?, notes = ?, total_amount = ?,
          store_id = COALESCE(?, store_id), store_name = COALESCE(?, store_name),
          updated_at = ?, last_synced_at = ?
      WHERE id = ?
    `
      )
      .bind(
        purchase.supplierName,
        purchase.supplierPhone || null,
        purchase.date || null,
        purchase.createdAt || null,
        purchase.invoiceNumber || null,
        purchase.paymentStatus || 'PAID',
        purchase.notes || null,
        purchase.totalAmount || 0,
        purchase.storeId || null,
        purchase.storeName || null,
        nowIso,
        nowIso,
        purchase.id
      )
      .run();
  } catch {
    try {
      await db
        .prepare(
          `
        UPDATE purchases
        SET supplier_name = ?, date = COALESCE(?, date),
            created_at = COALESCE(?, created_at),
            invoice_number = ?, payment_status = ?, notes = ?, total_amount = ?,
            store_id = COALESCE(?, store_id), store_name = COALESCE(?, store_name),
            updated_at = ?, last_synced_at = ?
        WHERE id = ?
      `
        )
        .bind(
          purchase.supplierName,
          purchase.date || null,
          purchase.createdAt || null,
          purchase.invoiceNumber || null,
          purchase.paymentStatus || 'PAID',
          purchase.notes || null,
          purchase.totalAmount || 0,
          purchase.storeId || null,
          purchase.storeName || null,
          nowIso,
          nowIso,
          purchase.id
        )
        .run();
    } catch {
      await db
        .prepare(
          `
        UPDATE purchases SET supplier_name = ?, date = COALESCE(?, date), invoice_number = ?, payment_status = ?, notes = ?, total_amount = ?, last_synced_at = ? WHERE id = ?
      `
        )
        .bind(
          purchase.supplierName,
          purchase.date || null,
          purchase.invoiceNumber || null,
          purchase.paymentStatus || 'PAID',
          purchase.notes || null,
          purchase.totalAmount || 0,
          nowIso,
          purchase.id
        )
        .run();
    }
  }

  for (const item of purchase.items || []) {
    await db
      .prepare(
        `
      INSERT INTO purchase_items (id, purchase_id, product_id, product_name, quantity, unit_cost, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `
      )
      .bind(
        item.id || crypto.randomUUID(),
        purchase.id,
        item.productId,
        item.productName,
        item.quantity || 0,
        item.unitCost || 0,
        item.total || 0
      )
      .run();

    const product = await db
      .prepare('SELECT current_stock, store_stock FROM products WHERE id = ?')
      .bind(item.productId)
      .first();

    if (product) {
      const currentStock = Number(product.current_stock) || 0;
      const currentStoreStock = Number(product.store_stock) || 0;
      const newPurchaseQty = Number(item.quantity) || 0;
      const newUnitCost = Number(item.unitCost) || 0;

      const hasSellingPrice =
        item.sellingPrice !== undefined &&
        item.sellingPrice !== null &&
        Number.isFinite(Number(item.sellingPrice)) &&
        Number(item.sellingPrice) >= 0;
      const newSellingPrice = hasSellingPrice
        ? Number(Number(item.sellingPrice).toFixed(2))
        : null;

      let newStock = currentStock;
      let newStoreStock = currentStoreStock;

      if (effectiveStoreId) {
        newStoreStock += newPurchaseQty;
        if (hasSellingPrice) {
          await db
            .prepare(
              `UPDATE products SET store_stock = ?, purchase_price = ?, selling_price = ?, updated_at = ? WHERE id = ?`
            )
            .bind(
              newStoreStock,
              Number(newUnitCost.toFixed(2)),
              newSellingPrice,
              nowIso,
              item.productId
            )
            .run();
        } else {
          await db
            .prepare(
              `UPDATE products SET store_stock = ?, purchase_price = ?, updated_at = ? WHERE id = ?`
            )
            .bind(
              newStoreStock,
              Number(newUnitCost.toFixed(2)),
              nowIso,
              item.productId
            )
            .run();
        }
      } else {
        newStock += newPurchaseQty;
        if (hasSellingPrice) {
          await db
            .prepare(
              `UPDATE products SET current_stock = ?, purchase_price = ?, selling_price = ?, updated_at = ? WHERE id = ?`
            )
            .bind(
              newStock,
              Number(newUnitCost.toFixed(2)),
              newSellingPrice,
              nowIso,
              item.productId
            )
            .run();
        } else {
          await db
            .prepare(
              `UPDATE products SET current_stock = ?, purchase_price = ?, updated_at = ? WHERE id = ?`
            )
            .bind(
              newStock,
              Number(newUnitCost.toFixed(2)),
              nowIso,
              item.productId
            )
            .run();
        }
      }
    }
  }
}

async function createPurchaseReturn(db: any, ret: any) {
  if (!ret?.id) return;

  const nowIso = new Date().toISOString();

  // Check if already synced (idempotent on retry so audit movements are not duplicated)
  const existing = await db
    .prepare('SELECT id FROM purchase_returns WHERE id = ?')
    .bind(ret.id)
    .first();

  await db
    .prepare(
      `
    INSERT INTO purchase_returns (
      id, return_number, purchase_id, purchase_number, shop_id, shop_name,
      store_id, store_name, supplier_name, invoice_number,
      total_return_qty, total_return_amount, reason,
      returned_by_user_id, returned_by_name, created_at, last_synced_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `
    )
    .bind(
      ret.id,
      ret.returnNumber,
      ret.purchaseId,
      ret.purchaseNumber || '',
      ret.shopId,
      ret.shopName || null,
      ret.storeId || null,
      ret.storeName || null,
      ret.supplierName || '',
      ret.invoiceNumber || null,
      Number(ret.totalReturnQty) || 0,
      Number(ret.totalReturnAmount) || 0,
      ret.reason || '',
      ret.returnedByUserId || 'system',
      ret.returnedByName || 'Admin',
      ret.createdAt || nowIso,
      nowIso
    )
    .run();

  for (const item of ret.items || []) {
    await db
      .prepare(
        `
      INSERT INTO purchase_return_items (
        id, return_id, product_id, product_name,
        original_qty, return_qty, remaining_qty, unit_cost, return_total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `
      )
      .bind(
        item.id || crypto.randomUUID(),
        ret.id,
        item.productId,
        item.productName || '',
        Number(item.originalQty) || 0,
        Number(item.returnQty) || 0,
        Number(item.remainingQty) || 0,
        Number(item.unitCost) || 0,
        Number(item.returnTotal) || 0
      )
      .run();

    // Record a RETURN audit movement once per synced purchase return
    // (Note: stock deduction itself is applied deterministically by UPDATE_PURCHASE)
    if (!existing && item.productId && Number(item.returnQty) > 0) {
      try {
        const product = await db
          .prepare('SELECT current_stock, store_stock FROM products WHERE id = ?')
          .bind(item.productId)
          .first();

        const postQty = ret.storeId
          ? Number(product?.store_stock) || 0
          : Number(product?.current_stock) || 0;
        const returnQty = Number(item.returnQty) || 0;

        await db
          .prepare(
            `
          INSERT INTO inventory_movements (
            id, shop_id, shop_name, store_id, product_id, product_name,
            previous_qty, change_qty, new_qty, type, reason, cost_value,
            reference_id, user_id, user_name, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `
          )
          .bind(
            `pr-mov-${ret.id}-${item.id || item.productId}`,
            ret.shopId,
            ret.shopName || null,
            ret.storeId || null,
            item.productId,
            item.productName || '',
            postQty + returnQty,
            -returnQty,
            postQty,
            'RETURN',
            `Purchase Return ${ret.returnNumber} (PO ${ret.purchaseNumber || ret.purchaseId}): ${ret.reason || 'Supplier return'}`,
            Number(item.returnTotal) || 0,
            ret.purchaseId,
            ret.returnedByUserId || 'system',
            ret.returnedByName || 'Admin',
            ret.createdAt || nowIso
          )
          .run();
      } catch {
        // Non-blocking audit movement log
      }
    }
  }
}

async function deletePurchase(db: any, payload: any) {
  const purchaseId = payload?.id || payload?.purchaseId;
  if (!purchaseId) return;

  let existingPurchase: any = null;
  try {
    existingPurchase = await db
      .prepare(
        'SELECT id, shop_id, shop_name, store_id, supplier_name, purchase_number FROM purchases WHERE id = ?'
      )
      .bind(purchaseId)
      .first();
  } catch {
    existingPurchase = await db
      .prepare(
        'SELECT id, shop_id, shop_name, supplier_name, purchase_number FROM purchases WHERE id = ?'
      )
      .bind(purchaseId)
      .first();
  }

  // Only revert stock if the purchase still exists in D1 (idempotent on retry)
  if (existingPurchase) {
    const existingItemsRes = await db
      .prepare(
        'SELECT product_id, product_name, quantity, unit_cost, total FROM purchase_items WHERE purchase_id = ?'
      )
      .bind(purchaseId)
      .all();

    const itemsToRevert =
      existingItemsRes?.results && existingItemsRes.results.length > 0
        ? existingItemsRes.results.map((row: any) => ({
            productId: row.product_id,
            productName: row.product_name,
            quantity: Number(row.quantity) || 0,
            unitCost: Number(row.unit_cost) || 0,
            total: Number(row.total) || 0,
          }))
        : (payload.items || []).map((item: any) => ({
            productId: item.productId,
            productName: item.productName,
            quantity: Number(item.quantity) || 0,
            unitCost: Number(item.unitCost) || 0,
            total: Number(item.total) || 0,
          }));

    const nowIso = payload.voidedAt || new Date().toISOString();
    const isStorePurchase = Boolean(payload.storeId || existingPurchase.store_id);

    for (const item of itemsToRevert) {
      if (!item.productId || item.quantity <= 0) continue;

      const product = await db
        .prepare('SELECT current_stock, store_stock FROM products WHERE id = ?')
        .bind(item.productId)
        .first();

      if (product) {
        const prevFloor = Number(product.current_stock) || 0;
        const prevStore = Number(product.store_stock) || 0;

        if (isStorePurchase) {
          const nextStore = Math.max(0, prevStore - item.quantity);
          await db
            .prepare('UPDATE products SET store_stock = ?, updated_at = ? WHERE id = ?')
            .bind(nextStore, nowIso, item.productId)
            .run();

          await db
            .prepare(
              `
            INSERT INTO inventory_movements (
              id, shop_id, shop_name, store_id, product_id, product_name,
              previous_qty, change_qty, new_qty, type, reason, cost_value,
              reference_id, user_id, user_name, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
          `
            )
            .bind(
              crypto.randomUUID(),
              payload.shopId || existingPurchase.shop_id,
              payload.shopName || existingPurchase.shop_name || null,
              payload.storeId || null,
              item.productId,
              item.productName,
              prevStore,
              -item.quantity,
              nextStore,
              'VOID_RETURN',
              `Voided & deleted PO ${payload.purchaseNumber || existingPurchase.purchase_number || purchaseId}: ${payload.reason || 'Purchase voided'}`,
              item.total || item.unitCost * item.quantity,
              purchaseId,
              payload.voidedByUserId || 'system',
              payload.voidedByName || 'Admin',
              nowIso
            )
            .run();
        } else {
          const nextFloor = Math.max(0, prevFloor - item.quantity);
          await db
            .prepare('UPDATE products SET current_stock = ?, updated_at = ? WHERE id = ?')
            .bind(nextFloor, nowIso, item.productId)
            .run();

          await db
            .prepare(
              `
            INSERT INTO inventory_movements (
              id, shop_id, shop_name, store_id, product_id, product_name,
              previous_qty, change_qty, new_qty, type, reason, cost_value,
              reference_id, user_id, user_name, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
          `
            )
            .bind(
              crypto.randomUUID(),
              payload.shopId || existingPurchase.shop_id,
              payload.shopName || existingPurchase.shop_name || null,
              null,
              item.productId,
              item.productName,
              prevFloor,
              -item.quantity,
              nextFloor,
              'VOID_RETURN',
              `Voided & deleted PO ${payload.purchaseNumber || existingPurchase.purchase_number || purchaseId}: ${payload.reason || 'Purchase voided'}`,
              item.total || item.unitCost * item.quantity,
              purchaseId,
              payload.voidedByUserId || 'system',
              payload.voidedByName || 'Admin',
              nowIso
            )
            .run();
        }
      }
    }
  }

  await db
    .prepare('DELETE FROM purchase_items WHERE purchase_id = ?')
    .bind(purchaseId)
    .run();

  await db
    .prepare('DELETE FROM purchases WHERE id = ?')
    .bind(purchaseId)
    .run();
}

// ──────────────────────────────────────────────────────────
// SALE EDIT REQUESTS
// ──────────────────────────────────────────────────────────

async function createSaleEditRequest(db: any, request: any) {
  await db
    .prepare(
      `
    INSERT INTO sale_edit_requests (
      id, sale_id, requested_by_user_id, requested_by_name,
      original_values, new_values, reason, status,
      reviewed_by_user_id, reviewed_by_name, review_note,
      created_at, reviewed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `
    )
    .bind(
      request.id,
      request.saleId,
      request.requestedByUserId,
      request.requestedByName,
      JSON.stringify(request.originalValues),
      JSON.stringify(request.newValues),
      request.reason,
      request.status || 'PENDING',
      request.reviewedByUserId || null,
      request.reviewedByName || null,
      request.reviewNote || null,
      request.createdAt || new Date().toISOString(),
      request.reviewedAt || null
    )
    .run();
}

async function reviewSaleEditRequest(db: any, request: any) {
  console.log(
    '[reviewSaleEditRequest] Reviewing:',
    request.id,
    'status:',
    request.status
  );

  if (!request.id) {
    console.error('[reviewSaleEditRequest] ERROR: No ID');
    return;
  }

  await db
    .prepare(
      `
    UPDATE sale_edit_requests SET
      status = ?, reviewed_by_user_id = ?, reviewed_by_name = ?,
      review_note = ?, reviewed_at = ?
    WHERE id = ?
  `
    )
    .bind(
      request.status || 'PENDING',
      request.reviewedByUserId || null,
      request.reviewedByName || null,
      request.reviewNote || null,
      request.reviewedAt || new Date().toISOString(),
      request.id
    )
    .run();

  if (request.status === 'APPROVED') {
    const editRequest = await db
      .prepare('SELECT * FROM sale_edit_requests WHERE id = ?')
      .bind(request.id)
      .first();

    if (editRequest) {
      const newValues =
        typeof editRequest.new_values === 'string'
          ? JSON.parse(editRequest.new_values)
          : editRequest.new_values;

      const saleId = editRequest.sale_id;
      const now = new Date().toISOString();

      const oldItems = await db
        .prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?')
        .bind(saleId)
        .all();

      if (oldItems.results) {
        for (const oi of oldItems.results) {
          await db
            .prepare(
              `UPDATE products SET current_stock = current_stock + ?, updated_at = ? WHERE id = ?`
            )
            .bind(oi.quantity || 0, now, oi.product_id)
            .run();
        }
      }

      await db
        .prepare('DELETE FROM sale_items WHERE sale_id = ?')
        .bind(saleId)
        .run();

      for (const item of newValues.items || []) {
        await db
          .prepare(
            `
          INSERT INTO sale_items (
            id, sale_id, shop_id, product_id, product_name, sku,
            unit_price, purchase_price, quantity, discount, total,
            reference_price, reference_type
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
          )
          .bind(
            item.id || crypto.randomUUID(),
            saleId,
            item.shopId || null,
            item.productId,
            item.productName,
            item.sku,
            item.unitPrice || 0,
            item.purchasePrice || 0,
            item.quantity || 0,
            item.discount || 0,
            item.total || 0,
            item.referencePrice ?? null,
            item.referenceType ?? null
          )
          .run();

        await db
          .prepare(
            `UPDATE products SET current_stock = current_stock - ?, updated_at = ? WHERE id = ?`
          )
          .bind(item.quantity || 0, now, item.productId)
          .run();
      }

      await db
        .prepare(
          `
        UPDATE sales SET
          subtotal = ?, discount = ?, total = ?,
          cost_of_goods = ?, gross_profit = ?,
          amount_received = ?, change = ?, updated_at = ?
        WHERE id = ?
      `
        )
        .bind(
          newValues.subtotal || 0,
          newValues.discount || 0,
          newValues.total || 0,
          newValues.costOfGoods || 0,
          newValues.grossProfit || 0,
          newValues.amountReceived || 0,
          newValues.change || 0,
          now,
          saleId
        )
        .run();

      console.log('[reviewSaleEditRequest] ✅ Applied edit to sale:', saleId);
    }
  }
}

// ──────────────────────────────────────────────────────────
// EXPENSES / USERS / STOCK / SETTINGS / DEBTS
// ──────────────────────────────────────────────────────────

async function createExpense(db: any, expense: any) {
  await db
    .prepare(
      `
    INSERT INTO expenses (
      id, shop_id, shop_name, is_company_expense, category, description,
      title, amount, payment_method, date, reference, notes,
      created_by_user_id, created_by_name, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `
    )
    .bind(
      expense.id,
      expense.shopId || null,
      expense.shopName || null,
      expense.isCompanyExpense ? 1 : 0,
      expense.category,
      expense.description || '',
      expense.title || null,
      expense.amount || 0,
      expense.paymentMethod || 'CASH',
      expense.date || new Date().toISOString().slice(0, 10),
      expense.reference || null,
      expense.notes || null,
      expense.createdByUserId,
      expense.createdByName,
      expense.createdAt || new Date().toISOString()
    )
    .run();
}

async function upsertUser(db: any, user: any) {
  await db
    .prepare(
      `
    INSERT INTO users (
      id, username, name, role, password_hash, color, status,
      assigned_shop_ids, avatar_url, permissions, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username, name = excluded.name, role = excluded.role,
      password_hash = excluded.password_hash, color = excluded.color,
      status = excluded.status, assigned_shop_ids = excluded.assigned_shop_ids,
      avatar_url = excluded.avatar_url, permissions = excluded.permissions,
      updated_at = excluded.updated_at
  `
    )
    .bind(
      user.id,
      user.username || user.id,
      user.name,
      user.role || 'SELLER',
      user.passwordHash || user.password_hash || '',
      user.color || 'blue',
      user.status || 'ACTIVE',
      JSON.stringify(user.assignedShopIds || []),
      user.avatarUrl || user.avatar_url || null,
      JSON.stringify(user.permissions || {}),
      user.createdAt || new Date().toISOString(),
      user.updatedAt || new Date().toISOString()
    )
    .run();
}

async function recordStockAdjustment(db: any, movement: any) {
  await db
    .prepare(
      `
    INSERT INTO inventory_movements (
      id, shop_id, shop_name, store_id, product_id, product_name,
      previous_qty, change_qty, new_qty, type, reason, cost_value,
      reference_id, user_id, user_name, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `
    )
    .bind(
      movement.id || crypto.randomUUID(),
      movement.shopId,
      movement.shopName || null,
      movement.storeId || null,
      movement.productId,
      movement.productName,
      movement.previousQty || 0,
      movement.changeQty || 0,
      movement.newQty || 0,
      movement.type || 'ADJUSTMENT',
      movement.reason || '',
      movement.costValue || null,
      movement.referenceId || null,
      movement.userId,
      movement.userName,
      movement.createdAt || new Date().toISOString()
    )
    .run();

  if (movement.storeId) {
    await db
      .prepare(`UPDATE products SET store_stock = ?, updated_at = ? WHERE id = ?`)
      .bind(movement.newQty, new Date().toISOString(), movement.productId)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE products SET current_stock = ?, updated_at = ? WHERE id = ?`
      )
      .bind(movement.newQty, new Date().toISOString(), movement.productId)
      .run();
  }
}

let settingsAssistantColChecked = false;
let hasSettingsAssistantCol = false;

async function ensureSettingsAssistantColumn(db: any): Promise<boolean> {
  if (settingsAssistantColChecked) return hasSettingsAssistantCol;
  settingsAssistantColChecked = true;
  try {
    const info = await db.prepare('PRAGMA table_info(settings)').all();
    const cols = new Set(
      (info?.results || []).map((c: any) => String(c.name || '').toLowerCase())
    );
    if (!cols.has('enable_sales_assistant')) {
      await db
        .prepare('ALTER TABLE settings ADD COLUMN enable_sales_assistant INTEGER DEFAULT 0')
        .run();
    }
    hasSettingsAssistantCol = true;
  } catch {
    hasSettingsAssistantCol = false;
  }
  return hasSettingsAssistantCol;
}

async function updateSettings(db: any, settings: any) {
  const assistantColOk = await ensureSettingsAssistantColumn(db);
  if (assistantColOk) {
    await db
      .prepare(
        `
      UPDATE settings SET
        business_name = ?, tagline = ?, address = ?, phone = ?, email = ?,
        currency_symbol = ?, currency_code = ?, tax_rate_percent = ?, enable_tax = ?,
        enable_sales_assistant = ?,
        receipt_header_note = ?, receipt_footer_note = ?, receipt_paper_width = ?,
        low_stock_threshold_default = ?, updated_at = ?
      WHERE id = 'global'
    `
      )
      .bind(
        settings.businessName || 'Diocres Hardware&Retail Solutions',
        settings.tagline || null,
        settings.address || null,
        settings.phone || null,
        settings.email || null,
        settings.currencySymbol || 'TSh',
        settings.currencyCode || 'TZS',
        settings.taxRatePercent || 0,
        settings.enableTax ? 1 : 0,
        settings.enableSalesAssistant ? 1 : 0,
        settings.receiptHeaderNote || null,
        settings.receiptFooterNote || null,
        settings.receiptPaperWidth || '80mm',
        settings.lowStockThresholdDefault || 5,
        new Date().toISOString()
      )
      .run();
  } else {
    await db
      .prepare(
        `
      UPDATE settings SET
        business_name = ?, tagline = ?, address = ?, phone = ?, email = ?,
        currency_symbol = ?, currency_code = ?, tax_rate_percent = ?, enable_tax = ?,
        receipt_header_note = ?, receipt_footer_note = ?, receipt_paper_width = ?,
        low_stock_threshold_default = ?, updated_at = ?
      WHERE id = 'global'
    `
      )
      .bind(
        settings.businessName || 'Diocres Hardware&Retail Solutions',
        settings.tagline || null,
        settings.address || null,
        settings.phone || null,
        settings.email || null,
        settings.currencySymbol || 'TSh',
        settings.currencyCode || 'TZS',
        settings.taxRatePercent || 0,
        settings.enableTax ? 1 : 0,
        settings.receiptHeaderNote || null,
        settings.receiptFooterNote || null,
        settings.receiptPaperWidth || '80mm',
        settings.lowStockThresholdDefault || 5,
        new Date().toISOString()
      )
      .run();
  }
}

async function createDebt(db: any, debt: any) {
  await db
    .prepare(
      `
    INSERT INTO debts (
      id, type, debtor_name, product_description, amount, paid_amount,
      remaining_amount, due_date, contact, notes, status,
      created_by_user_id, created_by_name, shop_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type, debtor_name = excluded.debtor_name,
      product_description = excluded.product_description, amount = excluded.amount,
      paid_amount = excluded.paid_amount, remaining_amount = excluded.remaining_amount,
      due_date = excluded.due_date, contact = excluded.contact,
      notes = excluded.notes, status = excluded.status,
      updated_at = excluded.updated_at
  `
    )
    .bind(
      debt.id,
      debt.type,
      debt.debtorName,
      debt.productDescription || null,
      debt.amount || 0,
      debt.paidAmount || 0,
      debt.remainingAmount || debt.amount || 0,
      debt.dueDate || null,
      debt.contact || null,
      debt.notes || null,
      debt.status || 'PENDING',
      debt.createdByUserId,
      debt.createdByName,
      debt.shopId || null,
      debt.createdAt || new Date().toISOString(),
      debt.updatedAt || new Date().toISOString()
    )
    .run();
}

async function updateDebt(db: any, debt: any) {
  await db
    .prepare(
      `
    UPDATE debts SET
      type = ?, debtor_name = ?, product_description = ?, amount = ?,
      paid_amount = ?, remaining_amount = ?, due_date = ?, contact = ?,
      notes = ?, status = ?, updated_at = ?
    WHERE id = ?
  `
    )
    .bind(
      debt.type,
      debt.debtorName,
      debt.productDescription || null,
      debt.amount || 0,
      debt.paidAmount || 0,
      debt.remainingAmount || 0,
      debt.dueDate || null,
      debt.contact || null,
      debt.notes || null,
      debt.status || 'PENDING',
      new Date().toISOString(),
      debt.id
    )
    .run();
}

// ──────────────────────────────────────────────────────────
// STORE TRANSFER
// ──────────────────────────────────────────────────────────

async function transferStoreToShop(db: any, transfer: any) {
  const now = new Date().toISOString();

  // Validate store exists (FK pre-check for inventory_movements.store_id)
  if (transfer.storeId) {
    const store = await db
      .prepare('SELECT id FROM stores WHERE id = ?')
      .bind(transfer.storeId)
      .first();
    if (!store) {
      throw new Error(
        `Store ${transfer.storeId} does not exist in DB. Push the store before transferring.`
      );
    }
  }

  await ensureProductStoreColumns(db);

  const product = await db
    .prepare(
      'SELECT current_stock, store_stock, name FROM products WHERE id = ?'
    )
    .bind(transfer.productId)
    .first();

  if (!product) throw new Error('Product not found');

  const currentShopStock = Number(product.current_stock) || 0;
  const currentStoreStock = Number(product.store_stock) || 0;

  if (currentStoreStock < transfer.quantity) {
    throw new Error(`Not enough stock in store. Available: ${currentStoreStock}`);
  }

  const newShopStock = currentShopStock + transfer.quantity;
  const newStoreStock = currentStoreStock - transfer.quantity;

  await db
    .prepare(
      `UPDATE products 
       SET current_stock = ?, store_stock = ?, updated_at = ? 
       WHERE id = ?`
    )
    .bind(newShopStock, newStoreStock, now, transfer.productId)
    .run();

  if (transfer.nextStoreStocks || transfer.nextStoreDetails) {
    try {
      const storeColsOk = await ensureProductStoreColumns(db);
      if (storeColsOk) {
        if (transfer.nextStoreStocks && transfer.nextStoreDetails) {
          await db
            .prepare(
              'UPDATE products SET store_stocks = ?, store_details = ? WHERE id = ?'
            )
            .bind(
              JSON.stringify(transfer.nextStoreStocks),
              JSON.stringify(transfer.nextStoreDetails),
              transfer.productId
            )
            .run();
        } else if (transfer.nextStoreStocks) {
          await db
            .prepare('UPDATE products SET store_stocks = ? WHERE id = ?')
            .bind(JSON.stringify(transfer.nextStoreStocks), transfer.productId)
            .run();
        }
      }
    } catch {
      // Ignore if optional store columns are unavailable
    }
  }

  await db
    .prepare(
      `
    INSERT INTO inventory_movements (
      id, shop_id, shop_name, product_id, product_name, store_id,
      previous_qty, change_qty, new_qty, type, reason, 
      reference_id, user_id, user_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .bind(
      crypto.randomUUID(),
      transfer.shopId,
      transfer.shopName || null,
      transfer.productId,
      product.name,
      transfer.storeId,
      currentShopStock,
      transfer.quantity,
      newShopStock,
      'STORE_TRANSFER',
      `Transferred IN from ${transfer.storeName || 'Store'}`,
      transfer.transferId || null,
      transfer.transferredById,
      transfer.transferredByName,
      now
    )
    .run();

  await db
    .prepare(
      `
    INSERT INTO inventory_movements (
      id, shop_id, shop_name, product_id, product_name, store_id,
      previous_qty, change_qty, new_qty, type, reason, 
      reference_id, user_id, user_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .bind(
      crypto.randomUUID(),
      transfer.shopId,
      transfer.shopName || null,
      transfer.productId,
      product.name,
      transfer.storeId,
      currentStoreStock,
      -transfer.quantity,
      newStoreStock,
      'STORE_TRANSFER',
      `Transferred OUT to Shop`,
      transfer.transferId || null,
      transfer.transferredById,
      transfer.transferredByName,
      now
    )
    .run();
}

const STOCK_TRANSFERS_CREATE_SQL = (tableName: string) => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    id TEXT PRIMARY KEY,
    transfer_number TEXT,
    transfer_date TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_location TEXT,
    source_shop_id TEXT NOT NULL,
    source_shop_name TEXT,
    dest_type TEXT NOT NULL,
    dest_id TEXT NOT NULL,
    dest_name TEXT NOT NULL,
    dest_location TEXT,
    dest_shop_id TEXT NOT NULL,
    dest_shop_name TEXT,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    shipping_charges REAL DEFAULT 0,
    notice TEXT,
    items_json TEXT NOT NULL,
    total_units INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    created_by_user_id TEXT,
    created_by_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

let stockTransfersSchemaReady = false;

async function ensureStockTransfersTable(db: any) {
  if (stockTransfersSchemaReady) return;

  await db.prepare(STOCK_TRANSFERS_CREATE_SQL('stock_transfers')).run();

  const info = await db.prepare('PRAGMA table_info(stock_transfers)').all();
  const columns = (info?.results || []) as Array<{ name: string; notnull?: number }>;
  const colNames = new Set(columns.map(c => String(c.name || '').toLowerCase()));

  const isLegacySchema =
    !colNames.has('items_json') ||
    !colNames.has('source_id') ||
    !colNames.has('dest_id') ||
    columns.some(
      c =>
        ['store_id', 'shop_id', 'product_id', 'quantity', 'transferred_by_id', 'transferred_by_name'].includes(
          String(c.name || '').toLowerCase()
        ) && Number(c.notnull || 0) === 1
    );

  if (isLegacySchema) {
    // Migrate legacy single-product stock_transfers table to the multi-product schema
    await db.prepare('DROP TABLE IF EXISTS stock_transfers_v2').run();
    await db.prepare(STOCK_TRANSFERS_CREATE_SQL('stock_transfers_v2')).run();

    try {
      const legacyRows = await db.prepare('SELECT * FROM stock_transfers').all();
      for (const row of legacyRows?.results || []) {
        const createdAt = row.created_at || new Date().toISOString();
        const qty = Number(row.quantity || 0);
        const itemsJson = row.items_json
          ? String(row.items_json)
          : JSON.stringify(
              row.product_id
                ? [
                    {
                      productId: String(row.product_id),
                      productName: String(row.product_id),
                      quantity: qty,
                      unitPrice: 0,
                      subtotal: 0,
                    },
                  ]
                : []
            );

        await db
          .prepare(
            `
            INSERT OR REPLACE INTO stock_transfers_v2 (
              id, transfer_number, transfer_date,
              source_type, source_id, source_name, source_location, source_shop_id, source_shop_name,
              dest_type, dest_id, dest_name, dest_location, dest_shop_id, dest_shop_name,
              status, shipping_charges, notice, items_json,
              total_units, total_amount, created_by_user_id, created_by_name,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .bind(
            row.id,
            row.transfer_number || `TRF-${String(row.id || '').slice(0, 6).toUpperCase()}`,
            row.transfer_date || String(createdAt).slice(0, 10),
            row.source_type || 'STORE',
            row.source_id || row.store_id || '',
            row.source_name || 'Store',
            row.source_location || null,
            row.source_shop_id || row.shop_id || '',
            row.source_shop_name || null,
            row.dest_type || 'SHOP',
            row.dest_id || row.shop_id || '',
            row.dest_name || 'Shop',
            row.dest_location || null,
            row.dest_shop_id || row.shop_id || '',
            row.dest_shop_name || null,
            row.status || 'COMPLETED',
            Number(row.shipping_charges || 0),
            row.notice || row.notes || null,
            itemsJson,
            Number(row.total_units ?? qty),
            Number(row.total_amount || 0),
            row.created_by_user_id || row.transferred_by_id || null,
            row.created_by_name || row.transferred_by_name || null,
            createdAt,
            row.updated_at || createdAt
          )
          .run();
      }
    } catch (migrateErr: any) {
      console.error('[push] Legacy stock_transfers row copy warning:', migrateErr?.message || migrateErr);
    }

    await db.prepare('DROP TABLE stock_transfers').run();
    await db.prepare('ALTER TABLE stock_transfers_v2 RENAME TO stock_transfers').run();
    stockTransfersSchemaReady = true;
    return;
  }

  // Ensure any newer optional columns exist on an already-migrated table
  const requiredColumns: Array<{ name: string; sqlType: string }> = [
    { name: 'transfer_number', sqlType: 'TEXT' },
    { name: 'transfer_date', sqlType: "TEXT DEFAULT ''" },
    { name: 'source_type', sqlType: "TEXT DEFAULT 'STORE'" },
    { name: 'source_id', sqlType: "TEXT DEFAULT ''" },
    { name: 'source_name', sqlType: "TEXT DEFAULT 'Source'" },
    { name: 'source_location', sqlType: 'TEXT' },
    { name: 'source_shop_id', sqlType: "TEXT DEFAULT ''" },
    { name: 'source_shop_name', sqlType: 'TEXT' },
    { name: 'dest_type', sqlType: "TEXT DEFAULT 'SHOP'" },
    { name: 'dest_id', sqlType: "TEXT DEFAULT ''" },
    { name: 'dest_name', sqlType: "TEXT DEFAULT 'Destination'" },
    { name: 'dest_location', sqlType: 'TEXT' },
    { name: 'dest_shop_id', sqlType: "TEXT DEFAULT ''" },
    { name: 'dest_shop_name', sqlType: 'TEXT' },
    { name: 'status', sqlType: "TEXT DEFAULT 'COMPLETED'" },
    { name: 'shipping_charges', sqlType: 'REAL DEFAULT 0' },
    { name: 'notice', sqlType: 'TEXT' },
    { name: 'items_json', sqlType: "TEXT DEFAULT '[]'" },
    { name: 'total_units', sqlType: 'INTEGER DEFAULT 0' },
    { name: 'total_amount', sqlType: 'REAL DEFAULT 0' },
    { name: 'created_by_user_id', sqlType: 'TEXT' },
    { name: 'created_by_name', sqlType: 'TEXT' },
    { name: 'updated_at', sqlType: "TEXT DEFAULT ''" },
  ];

  for (const col of requiredColumns) {
    if (!colNames.has(col.name)) {
      try {
        await db
          .prepare(`ALTER TABLE stock_transfers ADD COLUMN ${col.name} ${col.sqlType}`)
          .run();
      } catch {
        // Ignore if concurrently added
      }
    }
  }

  stockTransfersSchemaReady = true;
}

async function upsertStockTransfer(db: any, t: any) {
  await ensureStockTransfersTable(db);
  const now = new Date().toISOString();
  await db
    .prepare(
      `
      INSERT INTO stock_transfers (
        id, transfer_number, transfer_date,
        source_type, source_id, source_name, source_location, source_shop_id, source_shop_name,
        dest_type, dest_id, dest_name, dest_location, dest_shop_id, dest_shop_name,
        status, shipping_charges, notice, items_json,
        total_units, total_amount, created_by_user_id, created_by_name,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        transfer_number = excluded.transfer_number,
        transfer_date = excluded.transfer_date,
        source_type = excluded.source_type,
        source_id = excluded.source_id,
        source_name = excluded.source_name,
        source_location = excluded.source_location,
        source_shop_id = excluded.source_shop_id,
        source_shop_name = excluded.source_shop_name,
        dest_type = excluded.dest_type,
        dest_id = excluded.dest_id,
        dest_name = excluded.dest_name,
        dest_location = excluded.dest_location,
        dest_shop_id = excluded.dest_shop_id,
        dest_shop_name = excluded.dest_shop_name,
        status = excluded.status,
        shipping_charges = excluded.shipping_charges,
        notice = excluded.notice,
        items_json = excluded.items_json,
        total_units = excluded.total_units,
        total_amount = excluded.total_amount,
        updated_at = excluded.updated_at
    `
    )
    .bind(
      t.id,
      t.transferNumber || null,
      t.transferDate || now.slice(0, 10),
      t.sourceType || 'STORE',
      t.sourceId || '',
      t.sourceName || 'Source',
      t.sourceLocation || null,
      t.sourceShopId || '',
      t.sourceShopName || null,
      t.destType || 'SHOP',
      t.destId || '',
      t.destName || 'Destination',
      t.destLocation || null,
      t.destShopId || '',
      t.destShopName || null,
      t.status || 'COMPLETED',
      Number(t.shippingCharges || 0),
      t.notice || null,
      JSON.stringify(t.items || []),
      Number(t.totalUnits || 0),
      Number(t.totalAmount || 0),
      t.createdByUserId || null,
      t.createdByName || null,
      t.createdAt || now,
      t.updatedAt || now
    )
    .run();
}

async function deleteStockTransfer(db: any, payload: any) {
  try {
    await ensureStockTransfersTable(db);
    await db
      .prepare('DELETE FROM stock_transfers WHERE id = ?')
      .bind(payload.id)
      .run();
  } catch {
    // Ignore if table doesn't exist
  }
  try {
    await db
      .prepare("DELETE FROM inventory_movements WHERE reference_id = ? AND type = 'STORE_TRANSFER'")
      .bind(payload.id)
      .run();
  } catch {
    // Ignore optional movement cleanup failure
  }
}
