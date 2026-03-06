const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

class ApiClient {
  constructor() {
    this.baseUrl = API_URL;
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  setTokens(accessToken, refreshToken) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
      ...options.headers,
    };

    try {
      const response = await fetch(url, { ...options, headers });

      // Handle 401 - try to refresh token
      if (response.status === 401 && this.refreshToken && !endpoint.includes('/auth/refresh')) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          headers.Authorization = `Bearer ${this.accessToken}`;
          return fetch(url, { ...options, headers }).then(r => this.handleResponse(r));
        } else {
          this.clearTokens();
          window.location.href = '/login';
          throw new Error('Session expired');
        }
      }

      return this.handleResponse(response);
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  async handleResponse(response) {
    if (response.status === 204) return null;
    
    const data = await response.json().catch(() => null);
    
    if (!response.ok) {
      const error = new Error(data?.error || 'Request failed');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    
    return data;
  }

  async refreshAccessToken() {
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
  async register(data) {
    const result = await this.request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
    this.setTokens(result.accessToken, result.refreshToken);
    return result;
  }

  async login(email, password) {
    const result = await this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.setTokens(result.accessToken, result.refreshToken);
    return result;
  }

  async logout() {
    await this.request('/api/auth/logout', { method: 'POST' }).catch(() => {});
    this.clearTokens();
  }

  async getMe() {
    return this.request('/api/auth/me');
  }

  async forgotPassword(email) {
    return this.request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  }

  async resetPassword(token, password) {
    return this.request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
  }

  // Generic CRUD
  async get(endpoint, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`${endpoint}${query ? '?' + query : ''}`);
  }

  async getOne(endpoint, id) {
    return this.request(`${endpoint}/${id}`);
  }

  async create(endpoint, data) {
    return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) });
  }

  async update(endpoint, id, data) {
    return this.request(`${endpoint}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async delete(endpoint, id) {
    return this.request(`${endpoint}/${id}`, { method: 'DELETE' });
  }

  async action(endpoint, id, action, data = {}) {
    return this.request(`${endpoint}/${id}/${action}`, { method: 'POST', body: JSON.stringify(data) });
  }

  // Contacts
  contacts = {
    list: (params) => this.get('/api/contacts', params),
    stats: () => this.get('/api/contacts/stats'),
    get: (id) => this.getOne('/api/contacts', id),
    create: (data) => this.create('/api/contacts', data),
    update: (id, data) => this.update('/api/contacts', id, data),
    delete: (id) => this.delete('/api/contacts', id),
    convert: (id) => this.action('/api/contacts', id, 'convert'),
  };

  // Projects
  projects = {
    list: (params) => this.get('/api/projects', params),
    stats: () => this.get('/api/projects/stats'),
    get: (id) => this.getOne('/api/projects', id),
    create: (data) => this.create('/api/projects', data),
    update: (id, data) => this.update('/api/projects', id, data),
    delete: (id) => this.delete('/api/projects', id),
  };

  // Jobs
  jobs = {
    list: (params) => this.get('/api/jobs', params),
    today: () => this.get('/api/jobs/today'),
    get: (id) => this.getOne('/api/jobs', id),
    create: (data) => this.create('/api/jobs', data),
    update: (id, data) => this.update('/api/jobs', id, data),
    delete: (id) => this.delete('/api/jobs', id),
    dispatch: (id) => this.action('/api/jobs', id, 'dispatch'),
    start: (id) => this.action('/api/jobs', id, 'start'),
    complete: (id) => this.action('/api/jobs', id, 'complete'),
  };

  // Quotes
  quotes = {
    list: (params) => this.get('/api/quotes', params),
    stats: () => this.get('/api/quotes/stats'),
    get: (id) => this.getOne('/api/quotes', id),
    create: (data) => this.create('/api/quotes', data),
    update: (id, data) => this.update('/api/quotes', id, data),
    delete: (id) => this.delete('/api/quotes', id),
    send: (id) => this.action('/api/quotes', id, 'send'),
    approve: (id) => this.action('/api/quotes', id, 'approve'),
    reject: (id) => this.action('/api/quotes', id, 'reject'),
    convertToInvoice: (id) => this.action('/api/quotes', id, 'convert-to-invoice'),
    downloadPdf: (id) => `${this.baseUrl}/api/quotes/${id}/pdf`,
  };

  // Invoices
  invoices = {
    list: (params) => this.get('/api/invoices', params),
    stats: () => this.get('/api/invoices/stats'),
    get: (id) => this.getOne('/api/invoices', id),
    create: (data) => this.create('/api/invoices', data),
    update: (id, data) => this.update('/api/invoices', id, data),
    delete: (id) => this.delete('/api/invoices', id),
    send: (id) => this.action('/api/invoices', id, 'send'),
    recordPayment: (id, data) => this.request(`/api/invoices/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
    downloadPdf: (id) => `${this.baseUrl}/api/invoices/${id}/pdf`,
  };

  // Documents
  documents = {
    list: (params) => this.get('/api/documents', params),
    get: (id) => this.getOne('/api/documents', id),
    upload: (formData) => this.request('/api/documents', { method: 'POST', body: formData }),
    uploadMultiple: (formData) => this.request('/api/documents/bulk', { method: 'POST', body: formData }),
    update: (id, data) => this.update('/api/documents', id, data),
    delete: (id) => this.delete('/api/documents', id),
  };

  // Time
  time = {
    list: (params) => this.get('/api/time', params),
    summary: (params) => this.get('/api/time/summary', params),
    create: (data) => this.create('/api/time', data),
    update: (id, data) => this.update('/api/time', id, data),
    delete: (id) => this.delete('/api/time', id),
    approve: (id) => this.action('/api/time', id, 'approve'),
  };

  // Expenses
  expenses = {
    list: (params) => this.get('/api/expenses', params),
    summary: (params) => this.get('/api/expenses/summary', params),
    create: (data) => this.create('/api/expenses', data),
    update: (id, data) => this.update('/api/expenses', id, data),
    delete: (id) => this.delete('/api/expenses', id),
    reimburse: (id) => this.action('/api/expenses', id, 'reimburse'),
  };

  // RFIs
  rfis = {
    list: (params) => this.get('/api/rfis', params),
    get: (id) => this.getOne('/api/rfis', id),
    create: (data) => this.create('/api/rfis', data),
    update: (id, data) => this.update('/api/rfis', id, data),
    delete: (id) => this.delete('/api/rfis', id),
    respond: (id, data) => this.action('/api/rfis', id, 'respond', data),
    close: (id) => this.action('/api/rfis', id, 'close'),
  };

  // Change Orders
  changeOrders = {
    list: (params) => this.get('/api/change-orders', params),
    get: (id) => this.getOne('/api/change-orders', id),
    create: (data) => this.create('/api/change-orders', data),
    update: (id, data) => this.update('/api/change-orders', id, data),
    delete: (id) => this.delete('/api/change-orders', id),
    submit: (id) => this.action('/api/change-orders', id, 'submit'),
    approve: (id, data) => this.action('/api/change-orders', id, 'approve', data),
    reject: (id) => this.action('/api/change-orders', id, 'reject'),
  };

  // Punch Lists
  punchLists = {
    list: (params) => this.get('/api/punch-lists', params),
    get: (id) => this.getOne('/api/punch-lists', id),
    create: (data) => this.create('/api/punch-lists', data),
    update: (id, data) => this.update('/api/punch-lists', id, data),
    delete: (id) => this.delete('/api/punch-lists', id),
    complete: (id) => this.action('/api/punch-lists', id, 'complete'),
    verify: (id, data) => this.action('/api/punch-lists', id, 'verify', data),
  };

  // Daily Logs
  dailyLogs = {
    list: (params) => this.get('/api/daily-logs', params),
    get: (id) => this.getOne('/api/daily-logs', id),
    create: (data) => this.create('/api/daily-logs', data),
    update: (id, data) => this.update('/api/daily-logs', id, data),
    delete: (id) => this.delete('/api/daily-logs', id),
  };

  // Inspections
  inspections = {
    list: (params) => this.get('/api/inspections', params),
    create: (data) => this.create('/api/inspections', data),
    update: (id, data) => this.update('/api/inspections', id, data),
    delete: (id) => this.delete('/api/inspections', id),
    pass: (id) => this.action('/api/inspections', id, 'pass'),
    fail: (id, data) => this.action('/api/inspections', id, 'fail', data),
  };

  // Bids
  bids = {
    list: (params) => this.get('/api/bids', params),
    stats: () => this.get('/api/bids/stats'),
    get: (id) => this.getOne('/api/bids', id),
    create: (data) => this.create('/api/bids', data),
    update: (id, data) => this.update('/api/bids', id, data),
    delete: (id) => this.delete('/api/bids', id),
    submit: (id) => this.action('/api/bids', id, 'submit'),
    won: (id) => this.action('/api/bids', id, 'won'),
    lost: (id) => this.action('/api/bids', id, 'lost'),
  };

  // Team
  team = {
    list: (params) => this.get('/api/team', params),
    get: (id) => this.getOne('/api/team', id),
    create: (data) => this.create('/api/team', data),
    update: (id, data) => this.update('/api/team', id, data),
    delete: (id) => this.delete('/api/team', id),
  };

  // Company
  company = {
    get: () => this.get('/api/company'),
    update: (data) => this.request('/api/company', { method: 'PUT', body: JSON.stringify(data) }),
    updateFeatures: (features) => this.request('/api/company/features', { method: 'PUT', body: JSON.stringify({ features }) }),
    users: () => this.get('/api/company/users'),
    createUser: (data) => this.request('/api/company/users', { method: 'POST', body: JSON.stringify(data) }),
    updateUser: (id, data) => this.request(`/api/company/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteUser: (id) => this.request(`/api/company/users/${id}`, { method: 'DELETE' }),
  };

  // Dashboard
  dashboard = {
    stats: () => this.get('/api/dashboard/stats'),
    recentActivity: () => this.get('/api/dashboard/recent-activity'),
  };
}

export const api = new ApiClient();
export default api;
