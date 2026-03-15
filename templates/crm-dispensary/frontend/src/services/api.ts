const API_URL = import.meta.env.VITE_API_URL || '';

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

  async post(endpoint, data = {}) {
    return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) });
  }

  async put(endpoint, data = {}) {
    return this.request(endpoint, { method: 'PUT', body: JSON.stringify(data) });
  }

  async create(endpoint, data) {
    return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) });
  }

  async update(endpoint, id, data) {
    return this.request(`${endpoint}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async delete(endpoint, id?) {
    const url = id ? `${endpoint}/${id}` : endpoint;
    return this.request(url, { method: 'DELETE' });
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

  // Search
  search = {
    query: (params) => this.get('/api/search', params),
  };
}

export const api = new ApiClient();
export default api;
