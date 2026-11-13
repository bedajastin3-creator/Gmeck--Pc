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
  const since = url.searchParams.get('since') || new Date(0).toISOString();

  try {
    const state: any = {};

    // ═══════════════════════════════════════════════════════
    // SHOPS
    // ═══════════════════════════════════════════════════════
    const shopsResult = await env.DB.prepare(
      'SELECT * FROM shops WHERE updated_at > ?'
    ).bind(since).all();
    state.shops = shopsResult.results;

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
    // PURCHASES
    // ═══════════════════════════════════════════════════════
    const purchasesResult = await env.DB.prepare(
      'SELECT * FROM purchases WHERE created_at > ?'
    ).bind(since).all();
    state.purchases = purchasesResult.results;

    const purchaseItemsResult = await env.DB.prepare(`
      SELECT pi.* FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      WHERE p.created_at > ?
    `).bind(since).all();
    state.purchaseItems = purchaseItemsResult.results;

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
