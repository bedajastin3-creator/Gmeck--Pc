import { db } from '../db/storage';
import { User, Sale } from '../types';

export class ReportService {
  public static getSellerDashboardSummary(sellerId: string, shopId?: string) {
    let sales = (db.getSales() || []).filter(s => s.sellerId === sellerId && s.status === 'COMPLETED');

    if (shopId && shopId !== 'ALL') {
      sales = sales.filter(s => s.shopId === shopId);
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const todaySales = sales.filter(s => s.createdAt && s.createdAt.slice(0, 10) === todayStr);

    const todayRevenue = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
    const todaySalesCount = todaySales.length;
    const todayItemsCount = todaySales.reduce(
      (sum, s) => sum + (s.items || []).reduce((iSum, item) => iSum + (item.quantity || 0), 0),
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

    // FIX: Allow Admin OR Seller with canViewReports permission
    if (!currentUser) {
      throw new Error('Permission Denied: User not found.');
    }
    
    if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canViewReports) {
      throw new Error('Permission Denied: Financial reporting is restricted to Administrators.');
    }

    const allSales = (db.getSales() || []).filter(s => s.status === 'COMPLETED');
    const allExpenses = db.getExpenses() || [];
    const shops = db.getShops() || [];
    const products = db.getProducts() || [];

    // Filter by shop if specified
    let filteredSales = allSales;
    let filteredExpenses = allExpenses;

    if (options.shopId && options.shopId !== 'ALL') {
      filteredSales = filteredSales.filter(s => s.shopId === options.shopId);
      filteredExpenses = filteredExpenses.filter(e => e.shopId === options.shopId);
    }

    if (options.sellerId && options.sellerId !== 'ALL') {
      filteredSales = filteredSales.filter(s => s.sellerId === options.sellerId);
    }

    // If seller (not admin) without full access, only show their own sales
    if (currentUser.role === 'SELLER' && !currentUser.permissions?.canViewReports) {
      filteredSales = filteredSales.filter(s => s.sellerId === currentUser.id);
    }

    // Filter by date range if specified
    if (dateRange.from) {
      const fromTime = new Date(dateRange.from).getTime();
      filteredSales = filteredSales.filter(s => new Date(s.createdAt).getTime() >= fromTime);
      filteredExpenses = filteredExpenses.filter(e => new Date(e.date).getTime() >= fromTime);
    }

    if (dateRange.to) {
      const toTime = new Date(dateRange.to).getTime() + 86400000;
      filteredSales = filteredSales.filter(s => new Date(s.createdAt).getTime() <= toTime);
      filteredExpenses = filteredExpenses.filter(e => new Date(e.date).getTime() <= toTime);
    }

    const totalGrossSales = filteredSales.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalCostOfGoods = filteredSales.reduce((sum, s) => sum + (s.costOfGoods || 0), 0);
    const totalGrossProfit = filteredSales.reduce((sum, s) => sum + (s.grossProfit || 0), 0);
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = totalGrossProfit - totalExpenses;
    const profitMarginPercent = totalGrossSales > 0 ? (totalGrossProfit / totalGrossSales) * 100 : 0;
    const netMarginPercent = totalGrossSales > 0 ? (netProfit / totalGrossSales) * 100 : 0;

    // Sales by Shop breakdown
    const shopSalesBreakdown: Record<string, { id: string; name: string; salesCount: number; totalSales: number; grossProfit: number; expenseTotal: number }> = {};
    shops.forEach(sh => {
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
      const shopKey = s.shopId || (shops[0]?.id || 'shop-1');
      if (!shopSalesBreakdown[shopKey]) {
        const found = shops.find(x => x.id === shopKey);
        shopSalesBreakdown[shopKey] = {
          id: shopKey,
          name: found ? found.name : 'Other Shop',
          salesCount: 0,
          totalSales: 0,
          grossProfit: 0,
          expenseTotal: 0,
        };
      }
      shopSalesBreakdown[shopKey].salesCount += 1;
      shopSalesBreakdown[shopKey].totalSales += (s.total || 0);
      shopSalesBreakdown[shopKey].grossProfit += (s.grossProfit || 0);
    });

    filteredExpenses.forEach(e => {
      if (e.shopId && shopSalesBreakdown[e.shopId]) {
        shopSalesBreakdown[e.shopId].expenseTotal += (e.amount || 0);
      }
    });

    // Top Selling Products in filtered set
    const productStats: Record<string, { id: string; name: string; sku: string; unitsSold: number; quantity: number; revenue: number; profit: number }> = {};
    filteredSales.forEach(sale => {
      (sale.items || []).forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        const sku = prod?.sku || item.productId;
        if (!productStats[item.productId]) {
          productStats[item.productId] = {
            id: item.productId,
            name: item.productName || prod?.name || 'Product',
            sku: sku,
            unitsSold: 0,
            quantity: 0,
            revenue: 0,
            profit: 0,
          };
        }
        const itemProfit = (item.total || 0) - ((item.purchasePrice || 0) * (item.quantity || 1));
        productStats[item.productId].unitsSold += (item.quantity || 1);
        productStats[item.productId].quantity += (item.quantity || 1);
        productStats[item.productId].revenue += (item.total || 0);
        productStats[item.productId].profit += itemProfit;
      });
    });

    const topSellingProducts = Object.values(productStats)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const topProducts = topSellingProducts;

    // Sales by Payment Method
    const paymentMethodBreakdown: Record<string, { method: string; count: number; total: number }> = {};
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
      paymentMethodBreakdown[pm].total += (sale.total || 0);
    });

    // Sales Performance by Cashier/Seller
    const sellerPerformanceMap: Record<string, { id: string; name: string; count: number; total: number; profit: number }> = {};
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
      sellerPerformanceMap[sId].total += (sale.total || 0);
      sellerPerformanceMap[sId].profit += (sale.grossProfit || 0);
    });

    const sellerPerformance = Object.values(sellerPerformanceMap);
    const sellerSales = sellerPerformance;

    // Daily Sales Timeline (for charts)
    const dailyMap: Record<string, { date: string; sales: number; profit: number; expenses: number }> = {};
    filteredSales.forEach(sale => {
      const day = sale.createdAt ? sale.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
      if (!dailyMap[day]) {
        dailyMap[day] = { date: day, sales: 0, profit: 0, expenses: 0 };
      }
      dailyMap[day].sales += (sale.total || 0);
      dailyMap[day].profit += (sale.grossProfit || 0);
    });

    filteredExpenses.forEach(exp => {
      const day = exp.date ? exp.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
      if (!dailyMap[day]) {
        dailyMap[day] = { date: day, sales: 0, profit: 0, expenses: 0 };
      }
      dailyMap[day].expenses += (exp.amount || 0);
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
      shopSalesBreakdown: Object.values(shopSalesBreakdown),
      timeline,
    };
  }
}
