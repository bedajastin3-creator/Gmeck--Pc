// src/services/cloudflareApi.ts (COMPLETE VERSION WITH R2 CUSTOM DOMAIN)
export interface CloudflareConfig {
  baseUrl: string;
  deviceId: string;
}

export class CloudflareApi {
  private static config: CloudflareConfig = {
    baseUrl: 'https://gmeck.sonkosound.store',
    deviceId: '',
  };
  
  private static token: string | null = localStorage.getItem('omnibiz_auth_token');

  // ==========================================
  // CONFIGURATION METHODS
  // ==========================================
  
  static setBaseUrl(url: string): void {
    this.config.baseUrl = url;
  }

  static getBaseUrl(): string {
    return this.config.baseUrl;
  }

  static getR2BaseUrl(): string {
    return 'https://m.gmeck.sonkosound.store';
  }

  static setToken(token: string): void {
    this.token = token;
    localStorage.setItem('omnibiz_auth_token', token);
  }

  static getToken(): string | null {
    return this.token;
  }

  static clearToken(): void {
    this.token = null;
    localStorage.removeItem('omnibiz_auth_token');
  }

  private static getDeviceId(): string {
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

  private static isOnline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine;
  }

  // ==========================================
  // CORE REQUEST METHOD
  // ==========================================
  
  private static async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.isOnline()) {
      throw new Error('OFFLINE: Cannot reach cloud endpoint');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-ID': this.getDeviceId(),
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(`${this.config.baseUrl}/api${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `API Error: ${response.status}`);
    }

    return await response.json();
  }

  // ==========================================
  // HEALTH CHECK
  // ==========================================
  
  static async checkConnection(): Promise<boolean> {
    if (!this.isOnline()) return false;
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
  
  static async login(username: string, password: string): Promise<{
    success: boolean;
    user?: any;
    token?: string;
    error?: string;
  }> {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  static async logout(userId: string): Promise<{ success: boolean }> {
    return this.request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  // ==========================================
  // SYNC ENDPOINTS
  // ==========================================
  
  static async pushSync(operations: any[]): Promise<{
    success: boolean;
    processedCount: number;
    failedCount: number;
    results: any[];
    errors: any[];
  }> {
    return this.request('/sync/push', {
      method: 'POST',
      body: JSON.stringify({ 
        deviceId: this.getDeviceId(), 
        operations 
      }),
    });
  }

  static async pullSync(since?: string, shopId?: string): Promise<{
    success: boolean;
    data: any;
  }> {
    const params = new URLSearchParams();
    if (since) params.append('since', since);
    if (shopId && shopId !== 'ALL') params.append('shopId', shopId);
    
    return this.request(`/sync/pull?${params.toString()}`);
  }

  // ==========================================
  // SHOPS ENDPOINTS
  // ==========================================
  
  static async getShops(status?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    return this.request(`/shops?${params}`);
  }

  static async createShop(shop: any): Promise<{ success: boolean; id: string }> {
    return this.request('/shops', {
      method: 'POST',
      body: JSON.stringify(shop),
    });
  }

  static async updateShop(id: string, shop: any): Promise<{ success: boolean }> {
    return this.request(`/shops/${id}`, {
      method: 'PUT',
      body: JSON.stringify(shop),
    });
  }

  static async getShop(id: string): Promise<any> {
    return this.request(`/shops/${id}`);
  }

  // ==========================================
  // PRODUCTS ENDPOINTS
  // ==========================================
  
  static async getProducts(filters?: {
    shopId?: string;
    status?: string;
    categoryId?: string;
    search?: string;
  }): Promise<any[]> {
    const params = new URLSearchParams();
    if (filters?.shopId) params.append('shopId', filters.shopId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.categoryId) params.append('categoryId', filters.categoryId);
    if (filters?.search) params.append('search', filters.search);
    return this.request(`/products?${params}`);
  }

  static async createProduct(product: any): Promise<{ success: boolean; id: string }> {
    return this.request('/products', {
      method: 'POST',
      body: JSON.stringify(product),
    });
  }

  static async updateProduct(id: string, product: any): Promise<{ success: boolean }> {
    return this.request(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    });
  }

  static async getProduct(id: string): Promise<any> {
    return this.request(`/products/${id}`);
  }

  // ==========================================
  // CATEGORIES ENDPOINTS
  // ==========================================
  
  static async getCategories(shopId?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (shopId) params.append('shopId', shopId);
    return this.request(`/categories?${params}`);
  }

  static async createCategory(category: any): Promise<{ success: boolean; id: string }> {
    return this.request('/categories', {
      method: 'POST',
      body: JSON.stringify(category),
    });
  }

  // ==========================================
  // SALES ENDPOINTS
  // ==========================================
  
  static async getSales(filters?: {
    shopId?: string;
    sellerId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<any[]> {
    const params = new URLSearchParams();
    if (filters?.shopId) params.append('shopId', filters.shopId);
    if (filters?.sellerId) params.append('sellerId', filters.sellerId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.search) params.append('search', filters.search);
    return this.request(`/sales?${params}`);
  }

  static async createSale(sale: any): Promise<{ success: boolean; id: string }> {
    return this.request('/sales', {
      method: 'POST',
      body: JSON.stringify(sale),
    });
  }

  static async voidSale(id: string, voidReason: string, voidedBy: string): Promise<{ success: boolean }> {
    return this.request(`/sales/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ voidReason, voidedBy }),
    });
  }

  // ==========================================
  // PURCHASES ENDPOINTS
  // ==========================================
  
  static async getPurchases(shopId?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (shopId) params.append('shopId', shopId);
    return this.request(`/purchases?${params}`);
  }

  static async createPurchase(purchase: any): Promise<{ success: boolean; id: string }> {
    return this.request('/purchases', {
      method: 'POST',
      body: JSON.stringify(purchase),
    });
  }

  // ==========================================
  // EXPENSES ENDPOINTS
  // ==========================================
  
  static async getExpenses(shopId?: string, category?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (shopId) params.append('shopId', shopId);
    if (category) params.append('category', category);
    return this.request(`/expenses?${params}`);
  }

  static async createExpense(expense: any): Promise<{ success: boolean; id: string }> {
    return this.request('/expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    });
  }

  // ==========================================
  // INVENTORY ENDPOINTS
  // ==========================================
  
  static async getMovements(productId?: string, shopId?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (productId) params.append('productId', productId);
    if (shopId) params.append('shopId', shopId);
    return this.request(`/inventory/movements?${params}`);
  }

  static async createMovement(movement: any): Promise<{ success: boolean; id: string }> {
    return this.request('/inventory/movements', {
      method: 'POST',
      body: JSON.stringify(movement),
    });
  }

  static async getValuation(shopId?: string): Promise<any> {
    const params = new URLSearchParams();
    if (shopId) params.append('shopId', shopId);
    return this.request(`/inventory/valuation?${params}`);
  }

  // ==========================================
  // DEBTS ENDPOINTS
  // ==========================================
  
  static async getDebts(type?: string, status?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    if (status) params.append('status', status);
    return this.request(`/debts?${params}`);
  }

  static async createDebt(debt: any): Promise<{ success: boolean; id: string }> {
    return this.request('/debts', {
      method: 'POST',
      body: JSON.stringify(debt),
    });
  }

  static async addDebtPayment(debtId: string, payment: any): Promise<{ success: boolean; id: string }> {
    return this.request(`/debts/${debtId}/payments`, {
      method: 'POST',
      body: JSON.stringify(payment),
    });
  }

  // ==========================================
  // NOTIFICATIONS ENDPOINTS
  // ==========================================
  
  static async getNotifications(userId: string, role: string): Promise<any[]> {
    const params = new URLSearchParams();
    params.append('userId', userId);
    params.append('role', role);
    return this.request(`/notifications?${params}`);
  }

  static async createNotification(notification: any): Promise<{ success: boolean; id: string }> {
    return this.request('/notifications', {
      method: 'POST',
      body: JSON.stringify(notification),
    });
  }

  static async markNotificationRead(notificationId: string, userId: string): Promise<{ success: boolean }> {
    return this.request('/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ notificationId, userId }),
    });
  }

  // ==========================================
  // SETTINGS ENDPOINTS
  // ==========================================
  
  static async getSettings(): Promise<any> {
    return this.request('/settings');
  }

  static async updateSettings(settings: any): Promise<{ success: boolean }> {
    return this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // ==========================================
  // R2 FILE OPERATIONS
  // ==========================================
  
  // Upload product or seller image to R2
  static async uploadImage(
    file: File | Blob,
    type: 'product' | 'seller',
    entityId: string,
    imageOrder: number = 0
  ): Promise<{ success: boolean; key: string; url: string; size: number }> {
    if (!this.isOnline()) {
      throw new Error('OFFLINE: Cannot upload file');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    formData.append('entityId', entityId);
    formData.append('imageOrder', imageOrder.toString());

    const response = await fetch(`${this.config.baseUrl}/api/r2/upload`, {
      method: 'POST',
      headers: {
        'X-Device-ID': this.getDeviceId(),
        ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    const result = await response.json();
    
    // Ensure URL uses custom R2 domain
    if (result.url && !result.url.includes('m.diocres.jobsreport.online')) {
      result.url = `https://m.gmeck.sonkosound.store/${result.key}`;
    }
    
    return result;
  }

  // Upload product image to R2 (legacy method)
  static async uploadFile(
    file: File | Blob,
    productId: string,
    imageOrder: number
  ): Promise<{ success: boolean; key: string; size: number; mimeType: string }> {
    return this.uploadImage(file, 'product', productId, imageOrder) as any;
  }

  // Upload backup to R2
  static async uploadBackup(backupFile: Blob): Promise<{ success: boolean; key: string; size: number }> {
    if (!this.isOnline()) {
      throw new Error('OFFLINE: Cannot upload backup');
    }

    const formData = new FormData();
    formData.append('backup', backupFile);

    const response = await fetch(`${this.config.baseUrl}/api/r2/backup`, {
      method: 'POST',
      headers: {
        'X-Device-ID': this.getDeviceId(),
        ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Backup upload failed: ${response.status}`);
    }

    return await response.json();
  }

  // Get R2 file URL (using custom domain)
  static getFileUrl(key: string): string {
    return `https://m.gmeck.sonkosound.store/${key}`;
  }

  // Delete R2 file
  static async deleteFile(key: string): Promise<{ success: boolean }> {
    return this.request(`/r2/files/${key}`, { method: 'DELETE' });
  }

  // List backups
  static async listBackups(): Promise<any[]> {
    const result = await this.request('/r2/backups');
    return result.backups || [];
  }
}
