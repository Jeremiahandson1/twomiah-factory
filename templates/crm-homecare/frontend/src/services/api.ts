import { createSessionFetch } from './sessionFetch';
import { toast } from '../components/Toast';

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
  refreshPromise: Promise<boolean> | null = null;
  /** Every access token this session has held — a screen may still be sending one it captured before a refresh. */
  issued = new Set<string>();

  constructor() {
    this.baseUrl = API_URL;
    this.accessToken = localStorage.getItem('accessToken') || localStorage.getItem('token');
    this.refreshToken = localStorage.getItem('refreshToken');
    if (this.accessToken) this.issued.add(this.accessToken);
  }

  setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.issued.add(accessToken);
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    // Remove legacy 'token' key if present
    localStorage.removeItem('token');
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    this.issued.clear();
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
      // An expired session is refreshed and the request replayed underneath fetch (services/sessionFetch.ts), for this
      // client and every raw fetch() alike — so a 401 that reaches here is a real refusal (a wrong password).
      const response = await fetchWithTimeout(url, { ...options, headers });
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
  // Sign in — which may stop and ask for a code. A two-factor reply ({ mfaRequired, challengeId, … }) carries no
  // tokens, so setTokens must NOT run on it: it would store the string "undefined" as the bearer token.
  async login(email: string, password: string) {
    const result = await this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (result?.mfaRequired) return result;
    this.setTokens(result.accessToken, result.refreshToken);
    return result;
  }

  // Finish a sign-in that stopped for a code — the authenticator's six digits, or a recovery code. Answers exactly what
  // a password sign-in answers.
  async completeMfa(challengeId: string, code: string) {
    const result = await this.request('/api/auth/mfa', { method: 'POST', body: JSON.stringify({ challengeId, code }) });
    this.setTokens(result.accessToken, result.refreshToken);
    return result;
  }

  // Two-factor enrolment for the signed-in person — the shape the shared TwoFactorCard calls.
  mfa = {
    devices: () => this.request('/api/auth/mfa-devices/devices'),
    setup: () => this.request('/api/auth/mfa-devices/setup', { method: 'POST', body: '{}' }),
    verify: (deviceId: string, code: string) =>
      this.request('/api/auth/mfa-devices/verify', { method: 'POST', body: JSON.stringify({ deviceId, code }) }),
    newRecoveryCodes: (code: string) =>
      this.request('/api/auth/mfa-devices/recovery-codes', { method: 'POST', body: JSON.stringify({ code }) }),
    remove: (deviceId: string, code: string) =>
      this.request(`/api/auth/mfa-devices/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE', body: JSON.stringify({ code }) }),
  };

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

/** The lock page's address. The Factory's restart checkout returns here (?restarted=1). */
export const LOCK_PAGE = '/crm/paywall';
/** Raised when a portal request is refused 402 ACCOUNT_LOCKED (services/sessionFetch.ts rule 4). */
export const PORTAL_PAUSED_EVENT = 'portal:paused';

// Every request in this tab goes through one response path (services/sessionFetch.ts): the session refreshed and the
// request replayed on a 401, a dead session sent to sign in, a locked agency sent to the lock page, a View As refusal
// shown. Installed once, when this module first loads — before any screen can fetch.
if (typeof window !== 'undefined' && !(window as any).__homecareSessionFetch) {
  (window as any).__homecareSessionFetch = true;
  window.fetch = createSessionFetch(window.fetch.bind(window), {
    current: () => api.accessToken,
    owns: (token) => api.issued.has(token),
    refresh: () => (api.refreshToken ? api.refreshAccessToken() : Promise.resolve(false)),
    ended: () => {
      api.clearTokens();
      window.location.assign('/login?expired=1');
    },
    notify: (message) => toast(message, 'error', 6000),
    locked: () => window.location.assign(LOCK_PAGE),
    // A family or client portal refused because the agency is locked: the portal shows "paused" (App.tsx usePortalPaused).
    portalPaused: () => { (window as any).__portalPaused = true; window.dispatchEvent(new CustomEvent(PORTAL_PAUSED_EVENT)); },
    onLockPage: () => window.location.pathname.startsWith(LOCK_PAGE),
  }) as typeof window.fetch;
}

export default api;
