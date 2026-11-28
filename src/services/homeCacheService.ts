import { db } from '../db/storage';
import { BusinessSettings, Sale, Shop, User } from '../types';
import { getAdminManagedShops, hasAdminAccess, isPlatformAdmin } from '../utils/permissions';
import { ReportService } from './reportService';

const HOME_CACHE_STORAGE_KEY = 'gmeck_home_cache_v1';

export type HomeTimeFilter = 'today' | 'week' | 'month' | 'all';

export interface CachedAdminHomeSummary {
  totalGrossSales: number;
  totalCostOfGoods: number;
  totalGrossProfit: number;
  totalExpenses: number;
  netProfit: number;
  profitMarginPercent: number;
  netMarginPercent: number;
  transactionCount: number;
  recentSales: Sale[];
  topProducts: Array<{
    id: string;
    name: string;
    sku: string;
    unitsSold: number;
    quantity: number;
    revenue: number;
    profit: number;
  }>;
  sellerSales: Array<{
    id: string;
    name: string;
    count: number;
    total: number;
    profit: number;
  }>;
}

export interface CachedSellerHomeSummary {
  todayRevenue: number;
  todaySalesCount: number;
  todayItemsCount: number;
  allTimeRevenue: number;
  allTimeSalesCount: number;
  recentSales: Sale[];
}

export interface CachedHomeSnapshot {
  version: 1;
  userId: string;
  userSnapshot: User;
  cachedAt: string;
  settings: BusinessSettings;
  shops: Shop[];
  adminByShop?: Record<
    string,
    {
      lowStockCount: number;
      periods: Record<HomeTimeFilter, CachedAdminHomeSummary>;
    }
  >;
  sellerByShop?: Record<
    string,
    {
      lowStockCount: number;
      summary: CachedSellerHomeSummary;
    }
  >;
}

function toLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDateRangeForPeriod(period: HomeTimeFilter): { from?: string; to?: string } {
  const now = new Date();
  const todayKey = toLocalYMD(now);
  if (period === 'today') {
    return { from: todayKey, to: todayKey };
  }
  if (period === 'week') {
    const past = new Date(now);
    past.setDate(past.getDate() - 6);
    return { from: toLocalYMD(past), to: todayKey };
  }
  if (period === 'month') {
    const past = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toLocalYMD(past), to: todayKey };
  }
  return {};
}

export class HomeCacheService {
  public static load(expectedUserId?: string): CachedHomeSnapshot | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      const raw = localStorage.getItem(HOME_CACHE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedHomeSnapshot;
      if (!parsed || parsed.version !== 1 || !parsed.userId) return null;
      if (expectedUserId && parsed.userId !== expectedUserId) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  public static clear(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(HOME_CACHE_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }

  public static saveFromLiveState(currentUser: User | null): CachedHomeSnapshot | null {
    if (!currentUser || !db.isCloudLoaded()) return null;

    try {
      const allShops = db.getShops() || [];
      const allProducts = db.getProducts() || [];
      const settings = db.getSettings();
      const platformAdm = isPlatformAdmin(currentUser);
      const adminAccess = hasAdminAccess(currentUser);

      const accessibleShops: Shop[] = platformAdm
        ? allShops
        : adminAccess
          ? getAdminManagedShops(currentUser, allShops)
          : allShops.filter(
              s => s.status === 'ACTIVE' && (currentUser.assignedShopIds || []).includes(s.id)
            );

      const snapshot: CachedHomeSnapshot = {
        version: 1,
        userId: currentUser.id,
        userSnapshot: currentUser,
        cachedAt: new Date().toISOString(),
        settings,
        shops: accessibleShops,
      };

      if (adminAccess) {
        const shopKeys = ['ALL', ...accessibleShops.map(s => s.id)];
        const adminByShop: NonNullable<CachedHomeSnapshot['adminByShop']> = {};

        for (const shopKey of shopKeys) {
          const lowStockCount = allProducts.filter(
            p =>
              p.status === 'ACTIVE' &&
              p.currentStock <= p.minStock &&
              (shopKey === 'ALL'
                ? platformAdm || accessibleShops.some(sh => sh.id === p.shopId)
                : p.shopId === shopKey)
          ).length;

          const periods = {} as Record<HomeTimeFilter, CachedAdminHomeSummary>;
          (['today', 'week', 'month', 'all'] as HomeTimeFilter[]).forEach(period => {
            const range = getDateRangeForPeriod(period);
            const rawSummary = ReportService.getFinancialSummary(
              range,
              { shopId: shopKey },
              currentUser
            );
            const recentSales = [...(rawSummary.filteredSales || [])]
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              )
              .slice(0, 6);

            periods[period] = {
              totalGrossSales: rawSummary.totalGrossSales,
              totalCostOfGoods: rawSummary.totalCostOfGoods,
              totalGrossProfit: rawSummary.totalGrossProfit,
              totalExpenses: rawSummary.totalExpenses,
              netProfit: rawSummary.netProfit,
              profitMarginPercent: rawSummary.profitMarginPercent,
              netMarginPercent: rawSummary.netMarginPercent,
              transactionCount: rawSummary.transactionCount,
              recentSales,
              topProducts: (rawSummary.topProducts || []).slice(0, 5),
              sellerSales: (rawSummary.sellerSales || []).slice(0, 10),
            };
          });

          adminByShop[shopKey] = {
            lowStockCount,
            periods,
          };
        }

        snapshot.adminByShop = adminByShop;
      } else {
        const sellerShopKeys = ['ALL', ...accessibleShops.map(s => s.id)];
        const sellerByShop: NonNullable<CachedHomeSnapshot['sellerByShop']> = {};

        for (const shopKey of sellerShopKeys) {
          const lowStockCount = allProducts.filter(
            p =>
              p.status === 'ACTIVE' &&
              p.currentStock <= p.minStock &&
              (shopKey === 'ALL'
                ? accessibleShops.length === 0 ||
                  accessibleShops.some(sh => sh.id === p.shopId)
                : p.shopId === shopKey)
          ).length;

          const summary = ReportService.getSellerDashboardSummary(currentUser.id, shopKey);
          sellerByShop[shopKey] = {
            lowStockCount,
            summary,
          };
        }

        snapshot.sellerByShop = sellerByShop;
      }

      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(HOME_CACHE_STORAGE_KEY, JSON.stringify(snapshot));
      }

      return snapshot;
    } catch (err) {
      console.warn('[HomeCacheService] Failed to save Home snapshot:', err);
      return null;
    }
  }
}
