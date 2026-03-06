const API_URL = import.meta.env.VITE_API_URL || '{{BACKEND_URL}}';

class ApiService {
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

  async request(method, path, body, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Auto-refresh on 401
    if (res.status === 401 && this.refreshToken && !options._retry) {
      const refreshed = await this.refresh();
      if (refreshed) return this.request(method, path, body, { ...options, _retry: true });
      this.clearTokens();
      window.location.href = '/login';
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  async refresh() {
    try {
      const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!res.ok) return false;
      const { accessToken, refreshToken } = await res.json();
      this.setTokens(accessToken, refreshToken);
      return true;
    } catch { return false; }
  }

  get(path, opts) { return this.request('GET', path, null, opts); }
  post(path, body, opts) { return this.request('POST', path, body, opts); }
  put(path, body, opts) { return this.request('PUT', path, body, opts); }
  patch(path, body, opts) { return this.request('PATCH', path, body, opts); }
  delete(path, opts) { return this.request('DELETE', path, null, opts); }
}

export const api = new ApiService();
export default api;
