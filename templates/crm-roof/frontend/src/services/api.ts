import {
  getAccessToken, getRefreshToken,
  setTokens as storeTokens, clearTokens as dropTokens,
} from '../lib/authToken';

const API_URL = import.meta.env.VITE_API_URL || '';

// A hung backend used to leave requests pending forever ("Saving…" with no
// error). Abort after this long so the UI surfaces a real, retryable error.
// Generous enough to survive a Render cold start, short enough to not hang.
const DEFAULT_TIMEOUT_MS = 45000;
function makeTransientError(message) {
  const err = new Error(message);
  err.status = 0;
  err.isTransient = true;
  return err;
}
async function fetchWithTimeout(url, init, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw makeTransientError('Request timed out — the server may be waking up. Please try again.');
    throw makeTransientError('Could not reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}

class ApiClient {
  constructor() {
    this.baseUrl = API_URL;
  }

  // Read through to storage on every use rather than caching a copy at construction.
  //
  // This client used to snapshot the token in its constructor, which runs once when the module is
  // first imported. AuthContext refreshes the token every 12 minutes and on login — none of which this
  // copy ever saw, so it held whatever had been left behind and went on presenting it. A tester found
  // it 5.6 days old and 401ing. One source of truth, read at the moment of use.
  get accessToken() { return getAccessToken() || null; }
  get refreshToken() { return getRefreshToken() || null; }
  set accessToken(v) { if (v) storeTokens(v); else dropTokens(); }
  set refreshToken(v) { if (v) storeTokens('', v); }

  setTokens(accessToken, refreshToken) {
    storeTokens(accessToken, refreshToken);
  }

  clearTokens() {
    dropTokens();
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
      ...options.headers,
    };

    try {
      const response = await fetchWithTimeout(url, { ...options, headers });

      // Handle 401 - try to refresh token
      if (response.status === 401 && this.refreshToken && !endpoint.includes('/auth/refresh')) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          headers.Authorization = `Bearer ${this.accessToken}`;
          return fetchWithTimeout(url, { ...options, headers }).then(r => this.handleResponse(r));
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
    // Single-flight: a page that fires several requests at once produces several
    // 401s, each calling this. The server ROTATES the refresh token on use, so the
    // second call presents a token the first already invalidated, fails, and logs
    // the user out mid-session (F-02). Share one in-flight refresh across callers.
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const response = await fetchWithTimeout(`${this.baseUrl}/api/auth/refresh`, {
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
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
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
    convert: (id) => this.action('/api/contacts', id, 'convert'),
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
    recordPayment: (id, data) => this.request(`/api/invoices/${id}/payment`, { method: 'POST', body: JSON.stringify(data) }),
    downloadPdf: (id) => `${this.baseUrl}/api/invoices/${id}/pdf`,
  };

  // Company
  company = {
    get: () => this.get('/api/company'),
    update: (data) => this.request('/api/company', { method: 'PUT', body: JSON.stringify(data) }),
    updateFeatures: (features) => this.request('/api/company/features', { method: 'PUT', body: JSON.stringify({ features }) }),
    featureCatalog: () => this.get('/api/company/features/catalog'),
    // The server serves user management at /api/users (not /api/company/users, which 404s). Settings
    // already fetches /api/users directly; these client helpers pointed at the dead path. Deactivate
    // via PUT { isActive: false } — there is no DELETE route.
    users: () => this.get('/api/users?includeInactive=1'),
    createUser: (data) => this.request('/api/users', { method: 'POST', body: JSON.stringify(data) }),
    updateUser: (id, data) => this.request(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteUser: (id) => this.request(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ isActive: false }) }),
  };
}

export const api = new ApiClient();
export default api;
