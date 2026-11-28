// src/services/cloudflareApi.ts
export interface CloudflareApiConfig {
  baseUrl: string;
  deviceId: string;
}

export class CloudflareApi {
  private static config: CloudflareApiConfig = {
    baseUrl: 'https://gmeck.sonkosound.store',
    deviceId: '',
  };

  private static token: string | null = localStorage.getItem('omnibiz_auth_token');

  // ==========================================
  // CONFIGURATION METHODS
  // ==========================================
  public static setBaseUrl(url: string): void {
    this.config.baseUrl = url;
  }

  public static getBaseUrl(): string {
    return this.config.baseUrl;
  }

  public static getR2BaseUrl(): string {
    return 'https://m.gmeck.sonkosound.store';
  }

  public static setToken(token: string): void {
    this.token = token;
    localStorage.setItem('omnibiz_auth_token', token);
  }

  public static getToken(): string | null {
    return this.token;
  }

  public static clearToken(): void {
    this.token = null;
    localStorage.removeItem('omnibiz_auth_token');
  }

  public static getDeviceId(): string {
    if (!this.config.deviceId) {
      const stored = localStorage.getItem('omnibiz_device_id');
      if (stored) {
        this.config.deviceId = stored;
      } else {
        this.config.deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem('omnibiz_device_id', this.config.deviceId);
      }
    }
    return this.config.deviceId;
  }

  public static readonly OFFLINE_ERROR_MESSAGE =
    'You are offline. Wait for internet connection.';

  private static connectionListeners = new Set<(online: boolean) => void>();

  public static onConnectionChange(listener: (online: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private static notifyConnection(online: boolean): void {
    this.connectionListeners.forEach(fn => {
      try {
        fn(online);
      } catch {
        // ignore listener error
      }
    });
  }

  public static isNetworkError(err: any): boolean {
    if (!this.isOnline()) return true;
    const msg = String(err?.message || err || '').toLowerCase();
    return (
      err?.name === 'TypeError' ||
      msg.includes('offline') ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('load failed') ||
      msg.includes('err_internet_disconnected') ||
      msg.includes('cannot reach cloud')
    );
  }

  public static formatError(err: any, fallback: string = 'Request failed'): string {
    if (this.isNetworkError(err)) {
      return this.OFFLINE_ERROR_MESSAGE;
    }
    return err?.message || fallback;
  }

  public static isOnline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine;
  }

  // ==========================================
  // CORE REQUEST METHOD
  // ==========================================
  private static async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.isOnline()) {
      this.notifyConnection(false);
      throw new Error(this.OFFLINE_ERROR_MESSAGE);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-ID': this.getDeviceId(),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    };

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/api${endpoint}`, {
        cache: 'no-store',
        ...options,
        headers,
      });
    } catch (err: any) {
      this.notifyConnection(false);
      throw new Error(this.OFFLINE_ERROR_MESSAGE);
    }

    this.notifyConnection(true);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `API Error: ${response.status}`);
    }

    return await response.json();
  }

  // ==========================================
  // HEALTH CHECK
  // ==========================================
  public static async checkConnection(): Promise<boolean> {
    if (!this.isOnline()) {
      this.notifyConnection(false);
      return false;
    }
    try {
      await this.request('/health');
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================
  // AUTH ENDPOINTS
  // ==========================================
  public static async login(username: string, password: string): Promise<any> {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  public static async logout(userId: string): Promise<any> {
    return this.request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  // ==========================================
  // SYNC ENDPOINTS
  // ==========================================
  public static async pushSync(operations: any[]): Promise<{
    success: boolean;
    processedCount?: number;
    failedCount?: number;
    results?: any[];
    errors?: any[];
    error?: string;
  }> {
    if (!this.isOnline()) {
      this.notifyConnection(false);
      throw new Error(this.OFFLINE_ERROR_MESSAGE);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-ID': this.getDeviceId(),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/api/sync/push`, {
        method: 'POST',
        cache: 'no-store',
        headers,
        body: JSON.stringify({
          deviceId: this.getDeviceId(),
          operations,
        }),
      });
    } catch (err: any) {
      this.notifyConnection(false);
      throw new Error(this.OFFLINE_ERROR_MESSAGE);
    }

    this.notifyConnection(true);

    const data = await response.json().catch(() => null);

    // /api/sync/push returns 200 (all ok), 207 (partial), or 400 (all failed with per-item errors[]).
    // Preserve structured results/errors so SyncService can reconcile each operation accurately.
    if (data && (Array.isArray(data.results) || Array.isArray(data.errors))) {
      return data;
    }

    if (!response.ok) {
      throw new Error(data?.error || `API Error: ${response.status}`);
    }

    return data || { success: false, errors: [{ error: 'Empty sync response' }] };
  }

  public static async pullSync(since?: string, shopId?: string): Promise<any> {
    const params = new URLSearchParams();
    if (since) params.append('since', since);
    if (shopId && shopId !== 'ALL') params.append('shopId', shopId);
    const qs = params.toString();
    return this.request(qs ? `/sync/pull?${qs}` : '/sync/pull');
  }

  // ==========================================
  // SHOPS ENDPOINTS
  // ==========================================
  public static async getShops(status?: string): Promise<any> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    return this.request(`/shops?${params}`);
  }

  public static async createShop(shop: any): Promise<any> {
    return this.request('/shops', {
      method: 'POST',
      body: JSON.stringify(shop),
    });
  }

  public static async updateShop(id: string, shop: any): Promise<any> {
    return this.request(`/shops/${id}`, {
      method: 'PUT',
      body: JSON.stringify(shop),
    });
  }

  public static async getShop(id: string): Promise<any> {
    return this.request(`/shops/${id}`);
  }

  public static async deleteShop(id: string): Promise<any> {
    return this.request(`/shops/${id}`, {
      method: 'DELETE',
    });
  }

  // ==========================================
  // STORES (WAREHOUSES) ENDPOINTS
  // ==========================================
  public static async getStores(filters?: {
    shopId?: string;
    status?: string;
  }): Promise<any[]> {
    const params = new URLSearchParams();
    if (filters?.shopId && filters.shopId !== 'ALL') {
      params.append('shopId', filters.shopId);
    }
    if (filters?.status && filters.status !== 'ALL') {
      params.append('status', filters.status);
    }
    const qs = params.toString();
    const res = await this.request<any>(qs ? `/stores?${qs}` : '/stores');
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.stores)) return res.stores;
    if (res && Array.isArray(res.data)) return res.data;
    return [];
  }

  public static async getStore(id: string): Promise<any> {
    return this.request(`/stores/${id}`);
  }

  public static async createStore(store: any): Promise<any> {
    return this.request('/stores', {
      method: 'POST',
      body: JSON.stringify(store),
    });
  }

  public static async updateStore(id: string, store: any): Promise<any> {
    return this.request(`/stores/${id}`, {
      method: 'PUT',
      body: JSON.stringify(store),
    });
  }

  public static async deleteStore(id: string): Promise<any> {
    return this.request(`/stores/${id}`, {
      method: 'DELETE',
    });
  }

  // ==========================================
  // PRODUCTS ENDPOINTS
  // ==========================================
  public static async getProducts(filters?: {
    shopId?: string;
    status?: string;
    categoryId?: string;
    search?: string;
  }): Promise<any> {
    const params = new URLSearchParams();
    if (filters?.shopId) params.append('shopId', filters.shopId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.categoryId) params.append('categoryId', filters.categoryId);
    if (filters?.search) params.append('search', filters.search);
    return this.request(`/products?${params}`);
  }

  public static async createProduct(product: any): Promise<any> {
    return this.request('/products', {
      method: 'POST',
      body: JSON.stringify(product),
    });
  }

  public static async updateProduct(id: string, product: any): Promise<any> {
    return this.request(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    });
  }

  public static async getProduct(id: string): Promise<any> {
    return this.request(`/products/${id}`);
  }

  // ==========================================
  // CATEGORIES ENDPOINTS
  // ==========================================
  public static async getCategories(shopId?: string): Promise<any> {
    const params = new URLSearchParams();
    if (shopId) params.append('shopId', shopId);
    return this.request(`/categories?${params}`);
  }

  public static async createCategory(category: any): Promise<any> {
    return this.request('/categories', {
      method: 'POST',
      body: JSON.stringify(category),
    });
  }

  // ==========================================
  // SALES ENDPOINTS
  // ==========================================
  public static async getSales(filters?: {
    shopId?: string;
    sellerId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<any> {
    const params = new URLSearchParams();
    if (filters?.shopId) params.append('shopId', filters.shopId);
    if (filters?.sellerId) params.append('sellerId', filters.sellerId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.search) params.append('search', filters.search);
    return this.request(`/sales?${params}`);
  }

  public static async createSale(sale: any): Promise<any> {
    return this.request('/sales', {
      method: 'POST',
      body: JSON.stringify(sale),
    });
  }

  public static async voidSale(id: string, voidReason: string, voidedBy: string): Promise<any> {
    return this.request(`/sales/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ voidReason, voidedBy }),
    });
  }

  // ==========================================
  // PURCHASES ENDPOINTS
  // ==========================================
  public static async getPurchases(shopId?: string): Promise<any> {
    const params = new URLSearchParams();
    if (shopId) params.append('shopId', shopId);
    return this.request(`/purchases?${params}`);
  }

  public static async createPurchase(purchase: any): Promise<any> {
    return this.request('/purchases', {
      method: 'POST',
      body: JSON.stringify(purchase),
    });
  }

  // ==========================================
  // EXPENSES ENDPOINTS
  // ==========================================
  public static async getExpenses(shopId?: string, category?: string): Promise<any> {
    const params = new URLSearchParams();
    if (shopId) params.append('shopId', shopId);
    if (category) params.append('category', category);
    return this.request(`/expenses?${params}`);
  }

  public static async createExpense(expense: any): Promise<any> {
    return this.request('/expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    });
  }

  // ==========================================
  // INVENTORY ENDPOINTS
  // ==========================================
  public static async getMovements(productId?: string, shopId?: string): Promise<any> {
    const params = new URLSearchParams();
    if (productId) params.append('productId', productId);
    if (shopId) params.append('shopId', shopId);
    return this.request(`/inventory/movements?${params}`);
  }

  public static async createMovement(movement: any): Promise<any> {
    return this.request('/inventory/movements', {
      method: 'POST',
      body: JSON.stringify(movement),
    });
  }

  public static async getValuation(shopId?: string): Promise<any> {
    const params = new URLSearchParams();
    if (shopId) params.append('shopId', shopId);
    return this.request(`/inventory/valuation?${params}`);
  }

  // ==========================================
  // DEBTS ENDPOINTS
  // ==========================================
  public static async getDebts(type?: string, status?: string): Promise<any> {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    if (status) params.append('status', status);
    return this.request(`/debts?${params}`);
  }

  public static async createDebt(debt: any): Promise<any> {
    return this.request('/debts', {
      method: 'POST',
      body: JSON.stringify(debt),
    });
  }

  public static async addDebtPayment(debtId: string, payment: any): Promise<any> {
    return this.request(`/debts/${debtId}/payments`, {
      method: 'POST',
      body: JSON.stringify(payment),
    });
  }

  // ==========================================
  // NOTIFICATIONS ENDPOINTS
  // ==========================================
  public static async getNotifications(userId: string, role: string): Promise<any> {
    const params = new URLSearchParams();
    params.append('userId', userId);
    params.append('role', role);
    return this.request(`/notifications?${params}`);
  }

  public static async createNotification(notification: any): Promise<any> {
    return this.request('/notifications', {
      method: 'POST',
      body: JSON.stringify(notification),
    });
  }

  public static async markNotificationRead(notificationId: string, userId: string): Promise<any> {
    return this.request('/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ notificationId, userId }),
    });
  }

  // ==========================================
  // SETTINGS ENDPOINTS
  // ==========================================
  public static async getSettings(): Promise<any> {
    return this.request('/settings');
  }

  public static async updateSettings(settings: any): Promise<any> {
    return this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // ==========================================
  // R2 FILE OPERATIONS
  // ==========================================
  public static async uploadImage(
    file: Blob | File,
    type: string,
    entityId: string,
    imageOrder: number = 0
  ): Promise<any> {
    if (!this.isOnline()) {
      this.notifyConnection(false);
      throw new Error(this.OFFLINE_ERROR_MESSAGE);
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    formData.append('entityId', entityId);
    formData.append('imageOrder', imageOrder.toString());

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/api/r2/upload`, {
        method: 'POST',
        headers: {
          'X-Device-ID': this.getDeviceId(),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: formData,
      });
    } catch {
      this.notifyConnection(false);
      throw new Error(this.OFFLINE_ERROR_MESSAGE);
    }

    this.notifyConnection(true);

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    const result = await response.json();
    if (result.url && !result.url.includes('m.diocres.jobsreport.online')) {
      result.url = `https://m.gmeck.sonkosound.store/${result.key}`;
    }
    return result;
  }

  public static async uploadFile(file: Blob | File, productId: string, imageOrder: number): Promise<any> {
    return this.uploadImage(file, 'product', productId, imageOrder);
  }

  public static async uploadCustomerPhoto(
    file: Blob | File,
    recordId: string,
    imageOrder: number
  ): Promise<{ success: boolean; key: string; url: string; size?: number; mimeType?: string }> {
    return this.uploadImage(file, 'customer_record', recordId, imageOrder);
  }

  // ==========================================
  // CUSTOMER RECORDS ENDPOINTS
  // ==========================================
  public static async getCustomerRecords(search?: string, limit: number = 100): Promise<any[]> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('search', search.trim());
    params.set('limit', String(limit));
    const result = await this.request<{ success?: boolean; records?: any[] }>(
      `/customer-records?${params.toString()}`
    );
    return result.records || [];
  }

  public static async createCustomerRecord(record: {
    id?: string;
    customerName: string;
    phoneNumber: string;
    imageUrls: string[];
    saleId?: string;
    receiptNumber?: string;
    shopId?: string;
    shopName?: string;
    saleDate?: string;
    items?: any[];
    createdAt?: string;
  }): Promise<{ success: boolean; record?: any; error?: string }> {
    return this.request('/customer-records', {
      method: 'POST',
      body: JSON.stringify(record),
    });
  }

  public static async deleteCustomerRecord(id: string): Promise<{ success: boolean; id?: string }> {
    return this.request(`/customer-records/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  public static async uploadBackup(backupFile: Blob | File): Promise<any> {
    if (!this.isOnline()) {
      this.notifyConnection(false);
      throw new Error(this.OFFLINE_ERROR_MESSAGE);
    }

    const formData = new FormData();
    formData.append('backup', backupFile);

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/api/r2/backup`, {
        method: 'POST',
        headers: {
          'X-Device-ID': this.getDeviceId(),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: formData,
      });
    } catch {
      this.notifyConnection(false);
      throw new Error(this.OFFLINE_ERROR_MESSAGE);
    }

    this.notifyConnection(true);

    if (!response.ok) {
      throw new Error(`Backup upload failed: ${response.status}`);
    }

    return await response.json();
  }

  public static getFileUrl(key: string): string {
    return `https://m.gmeck.sonkosound.store/${key}`;
  }

  public static async deleteFile(key: string): Promise<any> {
    return this.request(`/r2/files/${key}`, { method: 'DELETE' });
  }

  public static async listBackups(): Promise<any[]> {
    const result = await this.request<{ backups?: any[] }>('/r2/backups');
    return result.backups || [];
  }
}
