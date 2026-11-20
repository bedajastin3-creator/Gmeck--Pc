// functions/api/sync/pull.ts
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-ID',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestGet(context: any) {
  const { request, env } = context;
  const url = new URL(request.url);
  const rawSince = url.searchParams.get('since');
  const hasSince = Boolean(rawSince && rawSince.trim() !== '');
  const since = hasSince ? rawSince! : new Date(0).toISOString();

  try {
    const state: any = {};

    // ═══════════════════════════════════════════════════════
    // SHOPS
    // ═══════════════════════════════════════════════════════
    const shopsResult = hasSince
      ? await env.DB.prepare(
          "SELECT * FROM shops WHERE updated_at > ? OR created_at > ? OR updated_at IS NULL OR updated_at = ''"
        )
          .bind(since, since)
          .all()
      : await env.DB.prepare('SELECT * FROM shops ORDER BY created_at DESC').all();
    state.shops = shopsResult.results || [];

    // ═══════════════════════════════════════════════════════
    // STORES (WAREHOUSES) — always include full/null-safe list
    // ═══════════════════════════════════════════════════════
    try {
      const storesResult = hasSince
        ? await env.DB.prepare(
            "SELECT * FROM stores WHERE updated_at > ? OR created_at > ? OR updated_at IS NULL OR updated_at = ''"
          )
            .bind(since, since)
            .all()
        : await env.DB.prepare('SELECT * FROM stores ORDER BY created_at DESC').all();
      state.stores = storesResult.results || [];
    } catch (storesErr: any) {
      console.error('[pull] Primary stores query failed, falling back to SELECT * FROM stores:', storesErr?.message || storesErr);
      try {
        const fallbackStores = await env.DB.prepare('SELECT * FROM stores').all();
        state.stores = fallbackStores.results || [];
      } catch (fallbackErr: any) {
        console.error('[pull] Fallback stores query failed:', fallbackErr?.message || fallbackErr);
        state.stores = [];
      }
    }

    // ═══════════════════════════════════════════════════════
    // USERS (always ALL — permissions may change)
    // ═══════════════════════════════════════════════════════
    const usersResult = await env.DB.prepare('SELECT * FROM users').all();
    state.users = usersResult.results;

    // ═══════════════════════════════════════════════════════
    // CATEGORIES
    // ═══════════════════════════════════════════════════════
    const categoriesResult = await env.DB.prepare(
      'SELECT * FROM categories WHERE updated_at > ?'
    ).bind(since).all();
    state.categories = categoriesResult.results;

    // ═══════════════════════════════════════════════════════
    // PRODUCTS
    // ═══════════════════════════════════════════════════════
    const productsResult = await env.DB.prepare(
      'SELECT * FROM products WHERE updated_at > ?'
    ).bind(since).all();
    state.products = productsResult.results;

    // ═══════════════════════════════════════════════════════
    // PRODUCT IMAGES
    // ═══════════════════════════════════════════════════════
    const productImagesResult = await env.DB.prepare(
      'SELECT * FROM product_images WHERE updated_at > ?'
    ).bind(since).all();
    state.productImages = productImagesResult.results;

    // ═══════════════════════════════════════════════════════
    // SALES — filtered by updated_at (so approved edits re-sync)
    // ═══════════════════════════════════════════════════════
    const salesResult = await env.DB.prepare(
      'SELECT * FROM sales WHERE updated_at > ?'
    ).bind(since).all();
    state.sales = salesResult.results;

    const saleItemsResult = await env.DB.prepare(`
      SELECT si.* FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.updated_at > ?
    `).bind(since).all();
    state.saleItems = saleItemsResult.results;

    // ═══════════════════════════════════════════════════════
    // SAFETY NET: also include sales that have an APPROVED
    // edit request, even if their updated_at is older than `since`.
    // This guarantees the seller always receives the corrected
    // sale the next time they pull after admin approval.
    // ═══════════════════════════════════════════════════════
    const approvedEditRequests = await env.DB.prepare(
      "SELECT sale_id FROM sale_edit_requests WHERE status = 'APPROVED'"
    ).all();

    const approvedSaleIds: string[] = (approvedEditRequests.results || [])
      .map((r: any) => r.sale_id)
      .filter(Boolean);

    if (approvedSaleIds.length > 0) {
      // D1 doesn't support array binding — build parameterized IN clause
      const placeholders = approvedSaleIds.map(() => '?').join(',');

      const extraSalesResult = await env.DB.prepare(
        `SELECT * FROM sales WHERE id IN (${placeholders})`
      ).bind(...approvedSaleIds).all();

      const extraItemsResult = await env.DB.prepare(
        `SELECT * FROM sale_items WHERE sale_id IN (${placeholders})`
      ).bind(...approvedSaleIds).all();

      // Merge into the main response (dedupe by id)
      const salesById = new Map<string, any>();
      (state.sales || []).forEach((s: any) => salesById.set(s.id, s));
      (extraSalesResult.results || []).forEach((s: any) => salesById.set(s.id, s));
      state.sales = Array.from(salesById.values());

      const itemsById = new Map<string, any>();
      (state.saleItems || []).forEach((i: any) => itemsById.set(i.id, i));
      (extraItemsResult.results || []).forEach((i: any) => itemsById.set(i.id, i));
      state.saleItems = Array.from(itemsById.values());

      console.log(
        '[pull] Safety net included',
        approvedSaleIds.length,
        'approved-edit sales'
      );
    }

    // ═══════════════════════════════════════════════════════
    // PURCHASES (includes updated_at so edits & returns re-sync)
    // ═══════════════════════════════════════════════════════
    try {
      const purchasesResult = hasSince
        ? await env.DB.prepare(
            "SELECT * FROM purchases WHERE updated_at > ? OR created_at > ? OR updated_at IS NULL OR updated_at = '' ORDER BY created_at DESC"
          )
            .bind(since, since)
            .all()
        : await env.DB.prepare('SELECT * FROM purchases ORDER BY created_at DESC').all();
      state.purchases = purchasesResult.results || [];

      const purchaseItemsResult = hasSince
        ? await env.DB.prepare(`
            SELECT pi.* FROM purchase_items pi
            JOIN purchases p ON pi.purchase_id = p.id
            WHERE p.updated_at > ? OR p.created_at > ? OR p.updated_at IS NULL OR p.updated_at = ''
          `)
            .bind(since, since)
            .all()
        : await env.DB.prepare('SELECT * FROM purchase_items').all();
      state.purchaseItems = purchaseItemsResult.results || [];
    } catch {
      const purchasesResult = await env.DB.prepare(
        'SELECT * FROM purchases WHERE created_at > ?'
      ).bind(since).all();
      state.purchases = purchasesResult.results || [];

      const purchaseItemsResult = await env.DB.prepare(`
        SELECT pi.* FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        WHERE p.created_at > ?
      `).bind(since).all();
      state.purchaseItems = purchaseItemsResult.results || [];
    }

    // ═══════════════════════════════════════════════════════
    // PURCHASE RETURNS (safe fallback if tables not migrated)
    // ═══════════════════════════════════════════════════════
    try {
      const returnsResult = hasSince
        ? await env.DB.prepare(
            'SELECT * FROM purchase_returns WHERE created_at > ? ORDER BY created_at DESC'
          )
            .bind(since)
            .all()
        : await env.DB.prepare('SELECT * FROM purchase_returns ORDER BY created_at DESC').all();
      state.purchaseReturns = returnsResult.results || [];

      const returnItemsResult = hasSince
        ? await env.DB.prepare(`
            SELECT pri.* FROM purchase_return_items pri
            JOIN purchase_returns pr ON pri.return_id = pr.id
            WHERE pr.created_at > ?
          `)
            .bind(since)
            .all()
        : await env.DB.prepare('SELECT * FROM purchase_return_items').all();
      state.purchaseReturnItems = returnItemsResult.results || [];
    } catch {
      state.purchaseReturns = [];
      state.purchaseReturnItems = [];
    }

    // ═══════════════════════════════════════════════════════
    // EXPENSES
    // ═══════════════════════════════════════════════════════
    const expensesResult = await env.DB.prepare(
      'SELECT * FROM expenses WHERE created_at > ?'
    ).bind(since).all();
    state.expenses = expensesResult.results;

    // ═══════════════════════════════════════════════════════
    // INVENTORY MOVEMENTS
    // ═══════════════════════════════════════════════════════
    const movementsResult = await env.DB.prepare(
      'SELECT * FROM inventory_movements WHERE created_at > ?'
    ).bind(since).all();
    state.movements = movementsResult.results;

    // ═══════════════════════════════════════════════════════
    // STOCK TRANSFERS (safe fallback if table not yet migrated)
    // ═══════════════════════════════════════════════════════
    try {
      const transfersResult = hasSince
        ? await env.DB.prepare(
            "SELECT * FROM stock_transfers WHERE updated_at > ? OR created_at > ? OR updated_at IS NULL OR updated_at = ''"
          )
            .bind(since, since)
            .all()
        : await env.DB.prepare('SELECT * FROM stock_transfers ORDER BY created_at DESC').all();
      state.stockTransfers = transfersResult.results || [];
    } catch {
      try {
        const fallbackTransfers = hasSince
          ? await env.DB.prepare(
              'SELECT * FROM stock_transfers WHERE created_at > ? ORDER BY created_at DESC'
            )
              .bind(since)
              .all()
          : await env.DB.prepare('SELECT * FROM stock_transfers ORDER BY created_at DESC').all();
        state.stockTransfers = fallbackTransfers.results || [];
      } catch {
        state.stockTransfers = [];
      }
    }

    // ═══════════════════════════════════════════════════════
    // DEBTS
    // ═══════════════════════════════════════════════════════
    const debtsResult = await env.DB.prepare(
      'SELECT * FROM debts WHERE updated_at > ?'
    ).bind(since).all();
    state.debts = debtsResult.results;

    // ═══════════════════════════════════════════════════════
    // SALE EDIT REQUESTS (always ALL — status changes matter)
    // ═══════════════════════════════════════════════════════
    const saleEditRequestsResult = await env.DB.prepare(
      'SELECT * FROM sale_edit_requests'
    ).all();
    state.saleEditRequests = saleEditRequestsResult.results;

    // ═══════════════════════════════════════════════════════
    // DEBT PAYMENTS (always ALL)
    // ═══════════════════════════════════════════════════════
    const debtPaymentsResult = await env.DB.prepare(
      'SELECT * FROM debt_payments'
    ).all();
    state.debtPayments = debtPaymentsResult.results;

    // ═══════════════════════════════════════════════════════
    // SETTINGS
    // ═══════════════════════════════════════════════════════
    const settingsResult = await env.DB.prepare(
      'SELECT * FROM settings WHERE id = ?'
    ).bind('global').first();
    state.settings = settingsResult;

    return new Response(JSON.stringify({ success: true, data: state }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
