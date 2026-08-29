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
  baseUrl: string;
  accessToken: string | null;
  refreshToken: string | null;

  constructor() {
    this.baseUrl = API_URL;
    this.accessToken = localStorage.getItem('accessToken') || localStorage.getItem('token');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    // Remove legacy 'token' key if present
    localStorage.removeItem('token');
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('token');
  }

  async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
      ...((options.headers as Record<string, string>) || {}),
    };

    try {
      const response = await fetchWithTimeout(url, { ...options, headers });

      // Handle 401 — try to refresh token
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

  async handleResponse(response: Response) {
    if (response.status === 204) return null;

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error: any = new Error(data?.error || 'Request failed');
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async refreshAccessToken(): Promise<boolean> {
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
  async login(email: string, password: string) {
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

  // Generic CRUD
  async get(endpoint: string, params: Record<string, any> = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`${endpoint}${query ? '?' + query : ''}`);
  }

  async post(endpoint: string, data: any = {}) {
    return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) });
  }

  async put(endpoint: string, data: any = {}) {
    return this.request(endpoint, { method: 'PUT', body: JSON.stringify(data) });
  }

  async del(endpoint: string) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  // Company/Agency
  company = {
    get: () => this.get('/api/company'),
    update: (data: any) => this.request('/api/company', { method: 'PUT', body: JSON.stringify(data) }),
    updateFeatures: (features: string[]) => this.request('/api/company/features', { method: 'PUT', body: JSON.stringify({ features }) }),
  };
}

export const api = new ApiClient();
export default api;
