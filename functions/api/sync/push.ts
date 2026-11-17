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
      await upsertProduct(db, payload);
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
    case 'TRANSFER_STORE_TO_SHOP':
      await transferStoreToShop(db, payload);
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
  if (!store?.id) {
    throw new Error('upsertStore: missing store.id');
  }
  if (!store?.shopId) {
    throw new Error('upsertStore: missing store.shopId');
  }

  // Explicit FK pre-check so errors surface with a clear message
  const shop = await db
    .prepare('SELECT id FROM shops WHERE id = ?')
    .bind(store.shopId)
    .first();

  if (!shop) {
    throw new Error(
      `Cannot upsert store "${store.name}" (id=${store.id}): shop_id "${store.shopId}" does not exist in DB. Push the shop before the store.`
    );
  }

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
      store.shopId,
      store.name,
      store.location || null,
      store.status || 'ACTIVE',
      store.createdAt || new Date().toISOString(),
      store.updatedAt || new Date().toISOString()
    )
    .run();
}

async function upsertProduct(db: any, product: any) {
  const currentStock = product.storeId ? 0 : product.currentStock || 0;
  const storeStock = product.storeId
    ? product.storeStock ?? product.currentStock ?? 0
    : product.storeStock ?? 0;

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
      product.categoryId,
      product.sellingPrice || 0,
      product.proposedSellingPrice || null,
      product.purchasePrice || 0,
      currentStock,
      storeStock,
      product.minStock || 5,
      product.unit || 'pcs',
      product.status || 'ACTIVE',
      product.imageUrl || product.image_url || null,
      product.createdAt || new Date().toISOString(),
      product.updatedAt || new Date().toISOString()
    )
    .run();

  if (product.storeId && currentStock === 0 && storeStock > 0) {
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

async function createSale(db: any, sale: any) {
  const now = new Date().toISOString();
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
  await db
    .prepare(
      `
    INSERT INTO purchases (
      id, purchase_number, shop_id, shop_name, supplier_name, date,
      total_amount, payment_status, notes, invoice_number,
      created_by_user_id, created_by_name, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `
    )
    .bind(
      purchase.id,
      purchase.purchaseNumber,
      purchase.shopId,
      purchase.shopName || null,
      purchase.supplierName,
      purchase.date || new Date().toISOString().slice(0, 10),
      purchase.totalAmount || 0,
      purchase.paymentStatus || 'PAID',
      purchase.notes || null,
      purchase.invoiceNumber || null,
      purchase.createdByUserId,
      purchase.createdByName,
      purchase.createdAt || new Date().toISOString()
    )
    .run();

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

      let newStock = currentStock;
      let newStoreStock = currentStoreStock;

      if (purchase.storeId) {
        newStoreStock += newPurchaseQty;
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
      } else {
        newStock += newPurchaseQty;
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
  const oldPurchase = await db
    .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
    .bind(purchase.id)
    .all();

  if (oldPurchase.results) {
    for (const oldItem of oldPurchase.results) {
      await db
        .prepare(
          `UPDATE products SET current_stock = current_stock - ?, updated_at = ? WHERE id = ?`
        )
        .bind(
          oldItem.quantity || 0,
          new Date().toISOString(),
          oldItem.product_id
        )
        .run();
    }
  }

  await db
    .prepare('DELETE FROM purchase_items WHERE purchase_id = ?')
    .bind(purchase.id)
    .run();

  await db
    .prepare(
      `
    UPDATE purchases SET supplier_name = ?, invoice_number = ?, payment_status = ?, notes = ?, total_amount = ? WHERE id = ?
  `
    )
    .bind(
      purchase.supplierName,
      purchase.invoiceNumber || null,
      purchase.paymentStatus || 'PAID',
      purchase.notes || null,
      purchase.totalAmount || 0,
      purchase.id
    )
    .run();

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

      let newStock = currentStock;
      let newStoreStock = currentStoreStock;

      if (purchase.storeId) {
        newStoreStock += newPurchaseQty;
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
      } else {
        newStock += newPurchaseQty;
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
  }
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

async function updateSettings(db: any, settings: any) {
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
