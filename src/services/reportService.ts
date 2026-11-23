import { db } from '../db/storage';
import { InventoryMovement, Product, Store, User } from '../types';
import {
  getAdminManagedShops,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../utils/permissions';

export type ProfitLossPeriod = 'day' | 'week' | 'month' | 'custom';

export interface ShopProfitLossRow {
  shopId: string;
  shopName: string;
  status: string;
  skuCount: number;
  totalUnits: number;
  floorUnits: number;
  storeUnits: number;
  floorCapital: number;
  storeCapital: number;
  totalCapital: number;
  expectedRetailValue: number;
  salesCount: number;
  revenue: number;
  costOfGoods: number;
  grossProfit: number;
  grossMarginPercent: number;
  expenses: number;
  stockLossUnits: number;
  stockLossValue: number;
  belowCostSalesLoss: number;
  totalLossAndExpenses: number;
  netProfit: number;
  netMarginPercent: number;
  capitalReturnPercent: number;
}

export interface ShopProfitLossSummary {
  shops: ShopProfitLossRow[];
  generalCompanyExpenses: number;
  totals: {
    skuCount: number;
    totalUnits: number;
    floorCapital: number;
    storeCapital: number;
    totalCapital: number;
    expectedRetailValue: number;
    salesCount: number;
    revenue: number;
    costOfGoods: number;
    grossProfit: number;
    grossMarginPercent: number;
    expenses: number;
    stockLossUnits: number;
    stockLossValue: number;
    belowCostSalesLoss: number;
    totalLossAndExpenses: number;
    netProfit: number;
    netMarginPercent: number;
    netAfterCompanyExpenses: number;
  };
}

function toLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function extractLocalYMD(value?: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return toLocalYMD(parsed);
  }
  return trimmed.slice(0, 10);
}

function isWithinDateRange(
  dateValue: string | undefined,
  dateRange: { from?: string; to?: string }
): boolean {
  if (!dateRange.from && !dateRange.to) return true;
  const ymd = extractLocalYMD(dateValue);
  if (!ymd) return false;
  if (dateRange.from && ymd < dateRange.from) return false;
  if (dateRange.to && ymd > dateRange.to) return false;
  return true;
}

function getAccessibleShopsForUser(currentUser: User) {
  const allShops = db.getShops() || [];
  if (isPlatformAdmin(currentUser)) return allShops;
  if (isShopAdmin(currentUser)) return getAdminManagedShops(currentUser, allShops);
  const assigned = currentUser.assignedShopIds || [];
  if (assigned.length === 0) return allShops;
  return allShops.filter(s => assigned.includes(s.id));
}

function computeProductWarehouseUnitsAndCapital(
  product: Product,
  shopStores: Store[]
): { storeUnits: number; storeCapital: number } {
  const buyPrice = Number(product.purchasePrice || 0);
  const warehouseStores = shopStores.filter(st => !st.isShopFloor);
  const warehouseIds = new Set(warehouseStores.map(st => st.id));

  if (product.storeStocks && warehouseStores.length > 0) {
    let mappedUnits = 0;
    let mappedCapital = 0;
    let hasWarehouseMapping = false;

    for (const [sid, rawQty] of Object.entries(product.storeStocks)) {
      if (!warehouseIds.has(sid)) continue;
      hasWarehouseMapping = true;
      const qty = Math.max(0, Number(rawQty || 0));
      mappedUnits += qty;

      const detail = product.storeDetails?.[sid];
      if (detail && detail.quantity === qty && detail.importedPurchaseValue !== undefined) {
        mappedCapital += Math.max(0, Number(detail.importedPurchaseValue || 0));
      } else {
        const unitBuy = detail?.unitPurchasePrice ?? buyPrice;
        mappedCapital += qty * unitBuy;
      }
    }

    if (hasWarehouseMapping && (mappedUnits > 0 || Number(product.storeStock || 0) === 0)) {
      return { storeUnits: mappedUnits, storeCapital: mappedCapital };
    }
  }

  const fallbackUnits = Math.max(0, Number(product.storeStock || 0));
  return {
    storeUnits: fallbackUnits,
    storeCapital: fallbackUnits * buyPrice,
  };
}

function isStockLossMovement(m: InventoryMovement): boolean {
  if (['DAMAGED', 'BROKEN', 'EXPIRED', 'LOST'].includes(m.type)) {
    return true;
  }
  if ((m.type === 'ADJUSTMENT' || m.type === 'CORRECTION') && Number(m.changeQty || 0) < 0) {
    const r = (m.reason || '').toLowerCase();
    return (
      r.includes('damag') ||
      r.includes('broken') ||
      r.includes('expir') ||
      r.includes('lost') ||
      r.includes('loss') ||
      r.includes('theft') ||
      r.includes('spoil') ||
      r.includes('shrink')
    );
  }
  return false;
}

export class ReportService {
  public static computeProfitLossDateRange(
    period: ProfitLossPeriod,
    customStart?: string,
    customEnd?: string
  ): { from?: string; to?: string } {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (period === 'day') {
      const today = toLocalYMD(now);
      return { from: today, to: today };
    }
    if (period === 'week') {
      const past = new Date(now);
      past.setDate(past.getDate() - 6);
      return { from: toLocalYMD(past), to: toLocalYMD(now) };
    }
    if (period === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toLocalYMD(startOfMonth), to: toLocalYMD(now) };
    }
    return {
      from: customStart || undefined,
      to: customEnd || undefined,
    };
  }

  public static getSellerDashboardSummary(sellerId: string, shopId?: string) {
    let sales = (db.getSales() || []).filter(
      s => s.sellerId === sellerId && s.status === 'COMPLETED'
    );

    if (shopId && shopId !== 'ALL') {
      sales = sales.filter(s => s.shopId === shopId);
    }

    const todayStr = toLocalYMD(new Date());
    const todaySales = sales.filter(
      s => s.createdAt && extractLocalYMD(s.createdAt) === todayStr
    );

    const todayRevenue = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
    const todaySalesCount = todaySales.length;
    const todayItemsCount = todaySales.reduce(
      (sum, s) =>
        sum + (s.items || []).reduce((iSum, item) => iSum + (item.quantity || 0), 0),
      0
    );

    const allTimeRevenue = sales.reduce((sum, s) => sum + (s.total || 0), 0);
    const allTimeSalesCount = sales.length;
    const recentSales = [...sales]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return {
      todayRevenue,
      todaySalesCount,
      todayItemsCount,
      allTimeRevenue,
      allTimeSalesCount,
      recentSales,
    };
  }

  public static getFinancialSummary(
    dateRange: { from?: string; to?: string },
    optionsOrUser: { shopId?: string; sellerId?: string } | User,
    maybeUser?: User
  ) {
    let currentUser: User;
    let options: { shopId?: string; sellerId?: string } = {};

    if ('role' in optionsOrUser) {
      currentUser = optionsOrUser as User;
    } else {
      options = optionsOrUser;
      currentUser = maybeUser as User;
    }

    if (!currentUser) {
      throw new Error('Permission Denied: User not found.');
    }

    if (!hasAdminAccess(currentUser) && !currentUser.permissions?.canViewReports) {
      throw new Error('Permission Denied: Financial reporting is restricted to Administrators.');
    }

    const visibleShops = getAccessibleShopsForUser(currentUser);
    const visibleShopIds = new Set(visibleShops.map(s => s.id));
    const platformAdmin = isPlatformAdmin(currentUser);

    const allSales = (db.getSales() || []).filter(s => s.status === 'COMPLETED');
    const allExpenses = db.getExpenses() || [];
    const products = db.getProducts() || [];

    let filteredSales = allSales;
    let filteredExpenses = allExpenses;

    if (!platformAdmin) {
      filteredSales = filteredSales.filter(s => s.shopId && visibleShopIds.has(s.shopId));
      filteredExpenses = filteredExpenses.filter(
        e => e.shopId && visibleShopIds.has(e.shopId)
      );
    }

    if (options.shopId && options.shopId !== 'ALL') {
      filteredSales = filteredSales.filter(s => s.shopId === options.shopId);
      filteredExpenses = filteredExpenses.filter(e => e.shopId === options.shopId);
    }

    if (options.sellerId && options.sellerId !== 'ALL') {
      filteredSales = filteredSales.filter(s => s.sellerId === options.sellerId);
    }

    // Filter by date range using local calendar dates
    if (dateRange.from || dateRange.to) {
      filteredSales = filteredSales.filter(s => isWithinDateRange(s.createdAt, dateRange));
      filteredExpenses = filteredExpenses.filter(e =>
        isWithinDateRange(e.date || e.createdAt, dateRange)
      );
    }

    const totalGrossSales = filteredSales.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalCostOfGoods = filteredSales.reduce((sum, s) => sum + (s.costOfGoods || 0), 0);
    const totalGrossProfit = filteredSales.reduce((sum, s) => sum + (s.grossProfit || 0), 0);
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = totalGrossProfit - totalExpenses;
    const profitMarginPercent =
      totalGrossSales > 0 ? (totalGrossProfit / totalGrossSales) * 100 : 0;
    const netMarginPercent =
      totalGrossSales > 0 ? (netProfit / totalGrossSales) * 100 : 0;

    // Sales by Shop breakdown
    const scopedShops =
      options.shopId && options.shopId !== 'ALL'
        ? visibleShops.filter(sh => sh.id === options.shopId)
        : visibleShops;

    const shopSalesBreakdown: Record<
      string,
      {
        id: string;
        name: string;
        salesCount: number;
        totalSales: number;
        grossProfit: number;
        expenseTotal: number;
      }
    > = {};
    scopedShops.forEach(sh => {
      shopSalesBreakdown[sh.id] = {
        id: sh.id,
        name: sh.name,
        salesCount: 0,
        totalSales: 0,
        grossProfit: 0,
        expenseTotal: 0,
      };
    });

    filteredSales.forEach(s => {
      const shopKey = s.shopId || scopedShops[0]?.id || 'shop-1';
      if (!shopSalesBreakdown[shopKey]) {
        const found = visibleShops.find(x => x.id === shopKey);
        shopSalesBreakdown[shopKey] = {
          id: shopKey,
          name: found ? found.name : s.shopName || 'Other Shop',
          salesCount: 0,
          totalSales: 0,
          grossProfit: 0,
          expenseTotal: 0,
        };
      }
      shopSalesBreakdown[shopKey].salesCount += 1;
      shopSalesBreakdown[shopKey].totalSales += s.total || 0;
      shopSalesBreakdown[shopKey].grossProfit += s.grossProfit || 0;
    });

    filteredExpenses.forEach(e => {
      if (e.shopId && shopSalesBreakdown[e.shopId]) {
        shopSalesBreakdown[e.shopId].expenseTotal += e.amount || 0;
      }
    });

    // Product Profitability in filtered set
    const productStats: Record<
      string,
      {
        id: string;
        name: string;
        sku: string;
        unitsSold: number;
        quantity: number;
        revenue: number;
        profit: number;
      }
    > = {};
    filteredSales.forEach(sale => {
      (sale.items || []).forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        const sku = item.sku || prod?.sku || item.productId;
        if (!productStats[item.productId]) {
          productStats[item.productId] = {
            id: item.productId,
            name: item.productName || prod?.name || 'Product',
            sku,
            unitsSold: 0,
            quantity: 0,
            revenue: 0,
            profit: 0,
          };
        }
        const qty = item.quantity || 0;
        const itemProfit = (item.total || 0) - (item.purchasePrice || 0) * qty;
        productStats[item.productId].unitsSold += qty;
        productStats[item.productId].quantity += qty;
        productStats[item.productId].revenue += item.total || 0;
        productStats[item.productId].profit += itemProfit;
      });
    });

    const sortedProducts = Object.values(productStats).sort(
      (a, b) => b.revenue - a.revenue
    );
    const topSellingProducts = sortedProducts.slice(0, 5);
    const topProducts = sortedProducts;

    // Sales by Payment Method
    const paymentMethodBreakdown: Record<
      string,
      { method: string; count: number; total: number }
    > = {};
    filteredSales.forEach(sale => {
      const pm = sale.paymentMethod || 'CASH';
      if (!paymentMethodBreakdown[pm]) {
        paymentMethodBreakdown[pm] = {
          method: pm,
          count: 0,
          total: 0,
        };
      }
      paymentMethodBreakdown[pm].count += 1;
      paymentMethodBreakdown[pm].total += sale.total || 0;
    });

    // Sales Performance by Cashier/Seller
    const sellerPerformanceMap: Record<
      string,
      { id: string; name: string; count: number; total: number; profit: number }
    > = {};
    filteredSales.forEach(sale => {
      const sId = sale.sellerId || 'unknown';
      const sName = sale.sellerName || 'Cashier';
      if (!sellerPerformanceMap[sId]) {
        sellerPerformanceMap[sId] = {
          id: sId,
          name: sName,
          count: 0,
          total: 0,
          profit: 0,
        };
      }
      sellerPerformanceMap[sId].count += 1;
      sellerPerformanceMap[sId].total += sale.total || 0;
      sellerPerformanceMap[sId].profit += sale.grossProfit || 0;
    });

    const sellerPerformance = Object.values(sellerPerformanceMap).sort(
      (a, b) => b.total - a.total
    );
    const sellerSales = sellerPerformance;

    // Daily Sales Timeline
    const dailyMap: Record<
      string,
      { date: string; sales: number; profit: number; expenses: number }
    > = {};
    filteredSales.forEach(sale => {
      const day = extractLocalYMD(sale.createdAt) || toLocalYMD(new Date());
      if (!dailyMap[day]) {
        dailyMap[day] = { date: day, sales: 0, profit: 0, expenses: 0 };
      }
      dailyMap[day].sales += sale.total || 0;
      dailyMap[day].profit += sale.grossProfit || 0;
    });

    filteredExpenses.forEach(exp => {
      const day = extractLocalYMD(exp.date || exp.createdAt) || toLocalYMD(new Date());
      if (!dailyMap[day]) {
        dailyMap[day] = { date: day, sales: 0, profit: 0, expenses: 0 };
      }
      dailyMap[day].expenses += exp.amount || 0;
    });

    const timeline = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalGrossSales,
      totalCostOfGoods,
      totalGrossProfit,
      totalExpenses,
      netProfit,
      profitMarginPercent: Number(profitMarginPercent.toFixed(1)),
      netMarginPercent: Number(netMarginPercent.toFixed(1)),
      transactionCount: filteredSales.length,
      filteredSales,
      topSellingProducts,
      topProducts,
      sellerPerformance,
      sellerSales,
      paymentMethodBreakdown: Object.values(paymentMethodBreakdown),
      shopSalesBreakdown: Object.values(shopSalesBreakdown).sort(
        (a, b) => b.totalSales - a.totalSales
      ),
      timeline,
    };
  }

  public static getShopProfitAndLoss(
    dateRange: { from?: string; to?: string },
    currentUser: User,
    options?: { shopId?: string }
  ): ShopProfitLossSummary {
    if (!currentUser) {
      throw new Error('Permission Denied: User not found.');
    }
    if (!hasAdminAccess(currentUser) && !currentUser.permissions?.canViewReports) {
      throw new Error('Permission Denied: Financial reporting is restricted.');
    }

    const platformAdmin = isPlatformAdmin(currentUser);
    const accessibleShops = getAccessibleShopsForUser(currentUser);
    const targetShops =
      options?.shopId && options.shopId !== 'ALL'
        ? accessibleShops.filter(s => s.id === options.shopId)
        : accessibleShops;

    const allProducts = db.getProducts() || [];
    const allStores = db.getStores() || [];
    const productMap = new Map(allProducts.map(p => [p.id, p]));

    const periodSales = (db.getSales() || []).filter(
      s => s.status === 'COMPLETED' && isWithinDateRange(s.createdAt, dateRange)
    );
    const periodExpenses = (db.getExpenses() || []).filter(e =>
      isWithinDateRange(e.date || e.createdAt, dateRange)
    );
    const periodLossMovements = (db.getMovements() || []).filter(
      m => isStockLossMovement(m) && isWithinDateRange(m.createdAt, dateRange)
    );

    const shopRows: ShopProfitLossRow[] = targetShops.map(shop => {
      const shopProducts = allProducts.filter(
        p => p.shopId === shop.id && p.status !== 'INACTIVE'
      );
      const shopStores = allStores.filter(st => st.shopId === shop.id);

      let floorUnits = 0;
      let storeUnits = 0;
      let floorCapital = 0;
      let storeCapital = 0;
      let expectedRetailValue = 0;

      for (const prod of shopProducts) {
        const fUnits = Math.max(0, Number(prod.currentStock || 0));
        const buyPrice = Number(prod.purchasePrice || 0);
        const sellPrice = Number(prod.sellingPrice || 0);
        const wh = computeProductWarehouseUnitsAndCapital(prod, shopStores);

        floorUnits += fUnits;
        storeUnits += wh.storeUnits;
        floorCapital += fUnits * buyPrice;
        storeCapital += wh.storeCapital;
        expectedRetailValue += (fUnits + wh.storeUnits) * sellPrice;
      }

      const totalUnits = floorUnits + storeUnits;
      const totalCapital = Number((floorCapital + storeCapital).toFixed(2));

      const shopSales = periodSales.filter(s => s.shopId === shop.id);
      const salesCount = shopSales.length;
      const revenue = Number(
        shopSales.reduce((sum, s) => sum + Number(s.total || 0), 0).toFixed(2)
      );
      const costOfGoods = Number(
        shopSales.reduce((sum, s) => sum + Number(s.costOfGoods || 0), 0).toFixed(2)
      );
      const grossProfit = Number(
        shopSales.reduce((sum, s) => sum + Number(s.grossProfit || 0), 0).toFixed(2)
      );
      const grossMarginPercent =
        revenue > 0 ? Number(((grossProfit / revenue) * 100).toFixed(1)) : 0;

      let belowCostSalesLoss = 0;
      for (const sale of shopSales) {
        for (const item of sale.items || []) {
          const buy = Number(item.purchasePrice || 0);
          const sold = Number(item.unitPrice || 0);
          const qty = Number(item.quantity || 0);
          if (buy > 0 && sold < buy && qty > 0) {
            belowCostSalesLoss += (buy - sold) * qty;
          }
        }
      }
      belowCostSalesLoss = Number(belowCostSalesLoss.toFixed(2));

      const expenses = Number(
        periodExpenses
          .filter(e => !e.isCompanyExpense && e.shopId === shop.id)
          .reduce((sum, e) => sum + Number(e.amount || 0), 0)
          .toFixed(2)
      );

      const shopLossMovs = periodLossMovements.filter(m => m.shopId === shop.id);
      let stockLossUnits = 0;
      let stockLossValue = 0;
      for (const m of shopLossMovs) {
        const units = Math.abs(Number(m.changeQty || 0));
        stockLossUnits += units;
        if (m.costValue !== undefined && m.costValue !== null && Number(m.costValue) > 0) {
          stockLossValue += Number(m.costValue);
        } else {
          const prod = productMap.get(m.productId);
          stockLossValue += units * Number(prod?.purchasePrice || 0);
        }
      }
      stockLossValue = Number(stockLossValue.toFixed(2));

      const totalLossAndExpenses = Number((expenses + stockLossValue).toFixed(2));
      const netProfit = Number((grossProfit - totalLossAndExpenses).toFixed(2));
      const netMarginPercent =
        revenue > 0 ? Number(((netProfit / revenue) * 100).toFixed(1)) : 0;
      const capitalReturnPercent =
        totalCapital > 0 ? Number(((netProfit / totalCapital) * 100).toFixed(1)) : 0;

      return {
        shopId: shop.id,
        shopName: shop.name,
        status: shop.status || 'ACTIVE',
        skuCount: shopProducts.length,
        totalUnits,
        floorUnits,
        storeUnits,
        floorCapital: Number(floorCapital.toFixed(2)),
        storeCapital: Number(storeCapital.toFixed(2)),
        totalCapital,
        expectedRetailValue: Number(expectedRetailValue.toFixed(2)),
        salesCount,
        revenue,
        costOfGoods,
        grossProfit,
        grossMarginPercent,
        expenses,
        stockLossUnits,
        stockLossValue,
        belowCostSalesLoss,
        totalLossAndExpenses,
        netProfit,
        netMarginPercent,
        capitalReturnPercent,
      };
    });

    const generalCompanyExpenses = platformAdmin
      ? Number(
          periodExpenses
            .filter(e => e.isCompanyExpense || !e.shopId)
            .reduce((sum, e) => sum + Number(e.amount || 0), 0)
            .toFixed(2)
        )
      : 0;

    const totalsSkuCount = shopRows.reduce((s, r) => s + r.skuCount, 0);
    const totalsUnits = shopRows.reduce((s, r) => s + r.totalUnits, 0);
    const totalsFloorCap = Number(
      shopRows.reduce((s, r) => s + r.floorCapital, 0).toFixed(2)
    );
    const totalsStoreCap = Number(
      shopRows.reduce((s, r) => s + r.storeCapital, 0).toFixed(2)
    );
    const totalsCapital = Number(
      shopRows.reduce((s, r) => s + r.totalCapital, 0).toFixed(2)
    );
    const totalsRetail = Number(
      shopRows.reduce((s, r) => s + r.expectedRetailValue, 0).toFixed(2)
    );
    const totalsSalesCount = shopRows.reduce((s, r) => s + r.salesCount, 0);
    const totalsRevenue = Number(
      shopRows.reduce((s, r) => s + r.revenue, 0).toFixed(2)
    );
    const totalsCogs = Number(
      shopRows.reduce((s, r) => s + r.costOfGoods, 0).toFixed(2)
    );
    const totalsGross = Number(
      shopRows.reduce((s, r) => s + r.grossProfit, 0).toFixed(2)
    );
    const totalsExp = Number(
      shopRows.reduce((s, r) => s + r.expenses, 0).toFixed(2)
    );
    const totalsLossUnits = shopRows.reduce((s, r) => s + r.stockLossUnits, 0);
    const totalsLossValue = Number(
      shopRows.reduce((s, r) => s + r.stockLossValue, 0).toFixed(2)
    );
    const totalsBelowCost = Number(
      shopRows.reduce((s, r) => s + r.belowCostSalesLoss, 0).toFixed(2)
    );
    const totalsLossAndExp = Number(
      shopRows.reduce((s, r) => s + r.totalLossAndExpenses, 0).toFixed(2)
    );
    const totalsNet = Number(
      shopRows.reduce((s, r) => s + r.netProfit, 0).toFixed(2)
    );

    return {
      shops: shopRows,
      generalCompanyExpenses,
      totals: {
        skuCount: totalsSkuCount,
        totalUnits: totalsUnits,
        floorCapital: totalsFloorCap,
        storeCapital: totalsStoreCap,
        totalCapital: totalsCapital,
        expectedRetailValue: totalsRetail,
        salesCount: totalsSalesCount,
        revenue: totalsRevenue,
        costOfGoods: totalsCogs,
        grossProfit: totalsGross,
        grossMarginPercent:
          totalsRevenue > 0
            ? Number(((totalsGross / totalsRevenue) * 100).toFixed(1))
            : 0,
        expenses: totalsExp,
        stockLossUnits: totalsLossUnits,
        stockLossValue: totalsLossValue,
        belowCostSalesLoss: totalsBelowCost,
        totalLossAndExpenses: totalsLossAndExp,
        netProfit: totalsNet,
        netMarginPercent:
          totalsRevenue > 0
            ? Number(((totalsNet / totalsRevenue) * 100).toFixed(1))
            : 0,
        netAfterCompanyExpenses: Number(
          (totalsNet - generalCompanyExpenses).toFixed(2)
        ),
      },
    };
  }
}
