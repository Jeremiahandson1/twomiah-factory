import type { ApiError, AuthData, ListParams } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>;
}

class ApiClient {
  readonly baseUrl: string;
  private accessToken: string | null;
  private refreshToken: string | null;
  private _refreshPromise: Promise<boolean> | null;

  constructor() {
    this.baseUrl = API_URL;
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
    this._refreshPromise = null;
  }

  setTokens(accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  }

  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
      ...options.headers,
    };

    try {
      const response = await fetch(url, { ...options, headers });

      // Handle 401 - try to refresh token (serialize concurrent refreshes)
      if (response.status === 401 && this.refreshToken && !endpoint.includes('/auth/refresh')) {
        if (!this._refreshPromise) {
          this._refreshPromise = this.refreshAccessToken().finally(() => { this._refreshPromise = null; });
        }
        const refreshed = await this._refreshPromise;
        if (refreshed) {
          headers.Authorization = `Bearer ${this.accessToken}`;
          return fetch(url, { ...options, headers }).then(r => this.handleResponse<T>(r));
        } else {
          this.clearTokens();
          window.dispatchEvent(new CustomEvent('auth:expired'));
          throw new Error('Session expired');
        }
      }

      return this.handleResponse<T>(response);
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  async handleResponse<T = any>(response: Response): Promise<T> {
    if (response.status === 204) return null as T;

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error: ApiError = new Error(data?.error || 'Request failed');
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data as T;
  }

  async refreshAccessToken(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      this.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  // Auth
  async register(data: Record<string, string>): Promise<AuthData> {
    const result = await this.request<AuthData>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
    this.setTokens(result.accessToken, result.refreshToken);
    return result;
  }

  async login(email: string, password: string): Promise<AuthData> {
    const result = await this.request<AuthData>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.setTokens(result.accessToken, result.refreshToken);
    return result;
  }

  async logout(): Promise<void> {
    await this.request('/api/auth/logout', { method: 'POST' }).catch(() => {});
    this.clearTokens();
  }

  async getMe(): Promise<any> {
    return this.request('/api/auth/me');
  }

  async forgotPassword(email: string): Promise<any> {
    return this.request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  }

  async resetPassword(token: string, password: string): Promise<any> {
    return this.request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
  }

  // Generic CRUD
  async get(endpoint: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) filtered[key] = String(value);
    }
    const query = new URLSearchParams(filtered).toString();
    return this.request(`${endpoint}${query ? '?' + query : ''}`);
  }

  async getOne(endpoint: string, id: string): Promise<any> {
    return this.request(`${endpoint}/${id}`);
  }

  async post(endpoint: string, data: unknown = {}): Promise<any> {
    return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) });
  }

  async put(endpoint: string, data: unknown = {}): Promise<any> {
    return this.request(endpoint, { method: 'PUT', body: JSON.stringify(data) });
  }

  async create(endpoint: string, data: unknown): Promise<any> {
    return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) });
  }

  async update(endpoint: string, id: string, data: unknown): Promise<any> {
    return this.request(`${endpoint}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async delete(endpoint: string, id?: string): Promise<any> {
    const url = id ? `${endpoint}/${id}` : endpoint;
    return this.request(url, { method: 'DELETE' });
  }

  async action(endpoint: string, id: string, action: string, data: unknown = {}): Promise<any> {
    return this.request(`${endpoint}/${id}/${action}`, { method: 'POST', body: JSON.stringify(data) });
  }

  async upload(endpoint: string, formData: FormData): Promise<any> {
    return this.request(endpoint, { method: 'POST', body: formData });
  }

  // Contacts
  contacts = {
    list: (params?: ListParams) => this.get('/api/contacts', params),
    stats: () => this.get('/api/contacts/stats'),
    get: (id: string) => this.getOne('/api/contacts', id),
    create: (data: unknown) => this.create('/api/contacts', data),
    update: (id: string, data: unknown) => this.update('/api/contacts', id, data),
    delete: (id: string) => this.delete('/api/contacts', id),
    convert: (id: string) => this.action('/api/contacts', id, 'convert'),
  };

  // Projects
  projects = {
    list: (params?: ListParams) => this.get('/api/projects', params),
    stats: () => this.get('/api/projects/stats'),
    get: (id: string) => this.getOne('/api/projects', id),
    create: (data: unknown) => this.create('/api/projects', data),
    update: (id: string, data: unknown) => this.update('/api/projects', id, data),
    delete: (id: string) => this.delete('/api/projects', id),
    activity: (id: string) => this.request(`/api/projects/${id}/activity`),
  };

  // Jobs
  jobs = {
    list: (params?: ListParams) => this.get('/api/jobs', params),
    today: () => this.get('/api/jobs/today'),
    get: (id: string) => this.getOne('/api/jobs', id),
    create: (data: unknown) => this.create('/api/jobs', data),
    update: (id: string, data: unknown) => this.update('/api/jobs', id, data),
    delete: (id: string) => this.delete('/api/jobs', id),
    dispatch: (id: string) => this.action('/api/jobs', id, 'dispatch'),
    start: (id: string) => this.action('/api/jobs', id, 'start'),
    complete: (id: string) => this.action('/api/jobs', id, 'complete'),
  };

  // Quotes
  quotes = {
    list: (params?: ListParams) => this.get('/api/quotes', params),
    stats: () => this.get('/api/quotes/stats'),
    get: (id: string) => this.getOne('/api/quotes', id),
    create: (data: unknown) => this.create('/api/quotes', data),
    update: (id: string, data: unknown) => this.update('/api/quotes', id, data),
    delete: (id: string) => this.delete('/api/quotes', id),
    send: (id: string) => this.action('/api/quotes', id, 'send'),
    approve: (id: string) => this.action('/api/quotes', id, 'approve'),
    reject: (id: string) => this.action('/api/quotes', id, 'reject'),
    convertToInvoice: (id: string) => this.action('/api/quotes', id, 'convert-to-invoice'),
    downloadPdf: (id: string): string => `${this.baseUrl}/api/quotes/${id}/pdf`,
  };

  // Invoices
  invoices = {
    list: (params?: ListParams) => this.get('/api/invoices', params),
    stats: () => this.get('/api/invoices/stats'),
    get: (id: string) => this.getOne('/api/invoices', id),
    create: (data: unknown) => this.create('/api/invoices', data),
    update: (id: string, data: unknown) => this.update('/api/invoices', id, data),
    delete: (id: string) => this.delete('/api/invoices', id),
    send: (id: string) => this.action('/api/invoices', id, 'send'),
    recordPayment: (id: string, data: unknown) => this.request(`/api/invoices/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
    downloadPdf: (id: string): string => `${this.baseUrl}/api/invoices/${id}/pdf`,
  };

  // Documents
  documents = {
    list: (params?: ListParams) => this.get('/api/documents', params),
    get: (id: string) => this.getOne('/api/documents', id),
    upload: (formData: FormData) => this.request('/api/documents', { method: 'POST', body: formData }),
    uploadMultiple: (formData: FormData) => this.request('/api/documents/bulk', { method: 'POST', body: formData }),
    update: (id: string, data: unknown) => this.update('/api/documents', id, data),
    delete: (id: string) => this.delete('/api/documents', id),
  };

  // Time
  time = {
    list: (params?: ListParams) => this.get('/api/time', params),
    summary: (params?: ListParams) => this.get('/api/time/summary', params),
    create: (data: unknown) => this.create('/api/time', data),
    update: (id: string, data: unknown) => this.update('/api/time', id, data),
    delete: (id: string) => this.delete('/api/time', id),
    approve: (id: string) => this.action('/api/time', id, 'approve'),
  };

  // Expenses
  expenses = {
    list: (params?: ListParams) => this.get('/api/expenses', params),
    summary: (params?: ListParams) => this.get('/api/expenses/summary', params),
    create: (data: unknown) => this.create('/api/expenses', data),
    update: (id: string, data: unknown) => this.update('/api/expenses', id, data),
    delete: (id: string) => this.delete('/api/expenses', id),
    reimburse: (id: string) => this.action('/api/expenses', id, 'reimburse'),
  };

  // RFIs
  rfis = {
    list: (params?: ListParams) => this.get('/api/rfis', params),
    get: (id: string) => this.getOne('/api/rfis', id),
    create: (data: unknown) => this.create('/api/rfis', data),
    update: (id: string, data: unknown) => this.update('/api/rfis', id, data),
    delete: (id: string) => this.delete('/api/rfis', id),
    respond: (id: string, data: unknown) => this.action('/api/rfis', id, 'respond', data),
    close: (id: string) => this.action('/api/rfis', id, 'close'),
  };

  // Change Orders
  changeOrders = {
    list: (params?: ListParams) => this.get('/api/change-orders', params),
    get: (id: string) => this.getOne('/api/change-orders', id),
    create: (data: unknown) => this.create('/api/change-orders', data),
    update: (id: string, data: unknown) => this.update('/api/change-orders', id, data),
    delete: (id: string) => this.delete('/api/change-orders', id),
    submit: (id: string) => this.action('/api/change-orders', id, 'submit'),
    approve: (id: string, data: unknown) => this.action('/api/change-orders', id, 'approve', data),
    reject: (id: string) => this.action('/api/change-orders', id, 'reject'),
  };

  // Punch Lists
  punchLists = {
    list: (params?: ListParams) => this.get('/api/punch-lists', params),
    get: (id: string) => this.getOne('/api/punch-lists', id),
    create: (data: unknown) => this.create('/api/punch-lists', data),
    update: (id: string, data: unknown) => this.update('/api/punch-lists', id, data),
    delete: (id: string) => this.delete('/api/punch-lists', id),
    complete: (id: string) => this.action('/api/punch-lists', id, 'complete'),
    verify: (id: string, data: unknown) => this.action('/api/punch-lists', id, 'verify', data),
  };

  // Daily Logs
  dailyLogs = {
    list: (params?: ListParams) => this.get('/api/daily-logs', params),
    get: (id: string) => this.getOne('/api/daily-logs', id),
    create: (data: unknown) => this.create('/api/daily-logs', data),
    update: (id: string, data: unknown) => this.update('/api/daily-logs', id, data),
    delete: (id: string) => this.delete('/api/daily-logs', id),
  };

  // Inspections
  inspections = {
    list: (params?: ListParams) => this.get('/api/inspections', params),
    create: (data: unknown) => this.create('/api/inspections', data),
    update: (id: string, data: unknown) => this.update('/api/inspections', id, data),
    delete: (id: string) => this.delete('/api/inspections', id),
    pass: (id: string) => this.action('/api/inspections', id, 'pass'),
    fail: (id: string, data: unknown) => this.action('/api/inspections', id, 'fail', data),
  };

  // Bids
  bids = {
    list: (params?: ListParams) => this.get('/api/bids', params),
    stats: () => this.get('/api/bids/stats'),
    get: (id: string) => this.getOne('/api/bids', id),
    create: (data: unknown) => this.create('/api/bids', data),
    update: (id: string, data: unknown) => this.update('/api/bids', id, data),
    delete: (id: string) => this.delete('/api/bids', id),
    submit: (id: string) => this.action('/api/bids', id, 'submit'),
    won: (id: string) => this.action('/api/bids', id, 'won'),
    lost: (id: string) => this.action('/api/bids', id, 'lost'),
  };

  // Team
  team = {
    list: (params?: ListParams) => this.get('/api/team', params),
    get: (id: string) => this.getOne('/api/team', id),
    create: (data: unknown) => this.create('/api/team', data),
    update: (id: string, data: unknown) => this.update('/api/team', id, data),
    delete: (id: string) => this.delete('/api/team', id),
  };

  // Company
  company = {
    get: () => this.get('/api/company'),
    update: (data: unknown) => this.request('/api/company', { method: 'PUT', body: JSON.stringify(data) }),
    updateFeatures: (features: string[]) => this.request('/api/company/features', { method: 'PUT', body: JSON.stringify({ features }) }),
    users: () => this.get('/api/company/users'),
    createUser: (data: unknown) => this.request('/api/company/users', { method: 'POST', body: JSON.stringify(data) }),
    updateUser: (id: string, data: unknown) => this.request(`/api/company/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteUser: (id: string) => this.request(`/api/company/users/${id}`, { method: 'DELETE' }),
  };

  // Dashboard
  dashboard = {
    stats: () => this.get('/api/dashboard/stats'),
    recentActivity: () => this.get('/api/dashboard/recent-activity'),
  };
}

export const api = new ApiClient();
export default api;
