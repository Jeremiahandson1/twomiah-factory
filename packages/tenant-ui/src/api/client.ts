// The browser API client — ONE implementation for every CRM (vendored into each template's
// frontend/src/shared; the template's services/api.ts re-exports the singleton below).
//
// Before this the seven templates carried five versions: two of them untyped, one that sent
// "?x=undefined" for absent filters, two that hard-navigated to /login on an expired session while the
// shared AuthContext was already listening for the auth:expired event, and only one (rv) that kept the
// session alive when the refresh endpoint was merely throttled. This is the union of the fixes:
//   - abort-on-timeout: a hung backend becomes a clear, retryable transient error (status 0, isTransient)
//   - single-flight refresh: a page firing several requests at once shares ONE refresh; the server rotates
//     refresh tokens, so parallel refreshes logged users out mid-session (F-02)
//   - tri-state refresh: 'ok' → retry the call; 'revoked' (401/403) → clear tokens + `auth:expired`;
//     'retry' (429/5xx/network, after 3 backed-off attempts) → keep the tokens, throw a soft 429 (C-03)
//   - get() drops undefined params instead of serialising them
import type { AuthData } from '../auth/types'

export interface ApiError extends Error {
  status?: number
  data?: unknown
  isTransient?: boolean
}

export interface ListParams {
  page?: number
  limit?: number
  search?: string
  sort?: string
  order?: 'asc' | 'desc'
  status?: string
  type?: string
  [key: string]: string | number | undefined
}

export interface RequestOptions extends RequestInit {
  headers?: Record<string, string>
  timeoutMs?: number
}

export interface ApiClientOptions {
  /** API origin; default VITE_API_URL or same-origin. */
  baseUrl?: string
  /** Per-request abort timeout. Default 45 s — long enough for a Render cold start, short enough to not hang. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 45_000
const REFRESH_ATTEMPTS = 3
const ACCESS_KEY = 'accessToken'
const REFRESH_KEY = 'refreshToken'

const storage = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
  remove: (k: string) => { try { localStorage.removeItem(k) } catch { /* private mode */ } },
}

/** Timeout / network / unreachable — NOT an auth failure; callers must not destroy the session on it. */
function transientError(message: string): ApiError {
  const err: ApiError = new Error(message)
  err.status = 0
  err.isTransient = true
  return err
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type RefreshOutcome = 'ok' | 'revoked' | 'retry'

export class ApiClient {
  readonly baseUrl: string
  private readonly timeoutMs: number
  private accessToken: string | null
  private refreshToken: string | null
  private _refreshPromise: Promise<RefreshOutcome> | null = null

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? ((import.meta as any).env?.VITE_API_URL || '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.accessToken = storage.get(ACCESS_KEY)
    this.refreshToken = storage.get(REFRESH_KEY)
  }

  setTokens(accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken
    this.refreshToken = refreshToken
    storage.set(ACCESS_KEY, accessToken)
    storage.set(REFRESH_KEY, refreshToken)
  }

  clearTokens(): void {
    this.accessToken = null
    this.refreshToken = null
    storage.remove(ACCESS_KEY)
    storage.remove(REFRESH_KEY)
  }

  /** fetch with an abort-on-timeout; a hung or unreachable backend becomes a transient error, never a promise that never settles. */
  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } catch {
      if (controller.signal.aborted) throw transientError('Request timed out — the server may be waking up. Please try again.')
      throw transientError('Could not reach the server. Check your connection and try again.')
    } finally {
      clearTimeout(timer)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const { timeoutMs = this.timeoutMs, ...fetchOptions } = options
    const headers: Record<string, string> = {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      ...options.headers,
    }

    const response = await this.fetchWithTimeout(url, { ...fetchOptions, headers }, timeoutMs)

    if (response.status === 401 && this.refreshToken && !endpoint.includes('/auth/refresh')) {
      if (!this._refreshPromise) {
        this._refreshPromise = this.refreshAccessToken().finally(() => { this._refreshPromise = null })
      }
      const outcome = await this._refreshPromise
      if (outcome === 'ok') {
        headers.Authorization = `Bearer ${this.accessToken}`
        const retry = await this.fetchWithTimeout(url, { ...fetchOptions, headers }, timeoutMs)
        return this.handleResponse<T>(retry)
      }
      if (outcome === 'revoked') {
        // Genuine revocation — the only case that ends the session. The shared AuthContext listens for this.
        this.clearTokens()
        window.dispatchEvent(new CustomEvent('auth:expired'))
        throw new Error('Session expired')
      }
      // Transient (429 / 5xx / network): keep the refresh token so a throttle can't log the user out.
      const busy: ApiError = new Error('Service is busy — please try again in a moment')
      busy.status = 429
      busy.isTransient = true
      throw busy
    }

    return this.handleResponse<T>(response)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleResponse<T = any>(response: Response): Promise<T> {
    if (response.status === 204) return null as T
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const error: ApiError = new Error(data?.error || 'Request failed')
      error.status = response.status
      error.data = data
      throw error
    }
    return data as T
  }

  /** 'ok' = refreshed; 'revoked' = session genuinely dead (401/403); 'retry' = transient after REFRESH_ATTEMPTS backed-off tries. */
  async refreshAccessToken(): Promise<RefreshOutcome> {
    for (let attempt = 0; attempt < REFRESH_ATTEMPTS; attempt++) {
      try {
        const response = await this.fetchWithTimeout(`${this.baseUrl}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        }, this.timeoutMs)
        if (response.ok) {
          const data = await response.json()
          this.setTokens(data.accessToken, data.refreshToken)
          return 'ok'
        }
        if (response.status === 401 || response.status === 403) return 'revoked'
      } catch { /* transient — fall through to the back-off */ }
      await sleep(800 * (attempt + 1))
    }
    return 'retry'
  }

  // ── Auth
  async login(email: string, password: string): Promise<AuthData> {
    const result = await this.request<AuthData>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    this.setTokens(result.accessToken, result.refreshToken)
    return result
  }

  async logout(): Promise<void> {
    await this.request('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: this.refreshToken }) }).catch(() => {})
    this.clearTokens()
  }

  async getMe(): Promise<any> { return this.request('/api/auth/me') }
  async forgotPassword(email: string): Promise<any> { return this.request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }) }
  async resetPassword(token: string, password: string): Promise<any> { return this.request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }) }

  // ── Generic CRUD
  async get(endpoint: string, params: Record<string, string | number | boolean | undefined | null> = {}): Promise<any> {
    const filtered: Record<string, string> = {}
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) filtered[key] = String(value)
    const query = new URLSearchParams(filtered).toString()
    return this.request(`${endpoint}${query ? '?' + query : ''}`)
  }
  async getOne(endpoint: string, id: string): Promise<any> { return this.request(`${endpoint}/${id}`) }
  async post(endpoint: string, data: unknown = {}): Promise<any> { return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) }) }
  async put(endpoint: string, data: unknown = {}): Promise<any> { return this.request(endpoint, { method: 'PUT', body: JSON.stringify(data) }) }
  async patch(endpoint: string, data: unknown = {}): Promise<any> { return this.request(endpoint, { method: 'PATCH', body: JSON.stringify(data) }) }
  async create(endpoint: string, data: unknown): Promise<any> { return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) }) }
  async update(endpoint: string, id: string, data: unknown): Promise<any> { return this.request(`${endpoint}/${id}`, { method: 'PUT', body: JSON.stringify(data) }) }
  async delete(endpoint: string, id?: string): Promise<any> { return this.request(id ? `${endpoint}/${id}` : endpoint, { method: 'DELETE' }) }
  async action(endpoint: string, id: string, action: string, data: unknown = {}): Promise<any> { return this.request(`${endpoint}/${id}/${action}`, { method: 'POST', body: JSON.stringify(data) }) }
  async upload(endpoint: string, formData: FormData): Promise<any> { return this.request(endpoint, { method: 'POST', body: formData }) }

  // ── Resource namespaces (URL builders; the union of what the templates' pages call)
  contacts = {
    list: (params?: ListParams) => this.get('/api/contacts', params),
    stats: () => this.get('/api/contacts/stats'),
    get: (id: string) => this.getOne('/api/contacts', id),
    create: (data: unknown) => this.create('/api/contacts', data),
    update: (id: string, data: unknown) => this.update('/api/contacts', id, data),
    delete: (id: string) => this.delete('/api/contacts', id),
    convert: (id: string) => this.action('/api/contacts', id, 'convert'),
  }

  projects = {
    list: (params?: ListParams) => this.get('/api/projects', params),
    stats: () => this.get('/api/projects/stats'),
    get: (id: string) => this.getOne('/api/projects', id),
    create: (data: unknown) => this.create('/api/projects', data),
    update: (id: string, data: unknown) => this.update('/api/projects', id, data),
    delete: (id: string) => this.delete('/api/projects', id),
    activity: (id: string) => this.request(`/api/projects/${id}/activity`),
  }

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
  }

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
    convertToJob: (id: string) => this.action('/api/quotes', id, 'convert-to-job'),
    downloadPdf: (id: string): string => `${this.baseUrl}/api/quotes/${id}/pdf`,
  }

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
  }

  documents = {
    list: (params?: ListParams) => this.get('/api/documents', params),
    get: (id: string) => this.getOne('/api/documents', id),
    upload: (formData: FormData) => this.request('/api/documents', { method: 'POST', body: formData }),
    uploadMultiple: (formData: FormData) => this.request('/api/documents/bulk', { method: 'POST', body: formData }),
    update: (id: string, data: unknown) => this.update('/api/documents', id, data),
    delete: (id: string) => this.delete('/api/documents', id),
    versions: (id: string) => this.get(`/api/documents/${id}/versions`),
    uploadVersion: (id: string, formData: FormData) => this.request(`/api/documents/${id}/versions`, { method: 'POST', body: formData }),
    restoreVersion: (id: string, versionId: string) => this.request(`/api/documents/${id}/versions/${versionId}/restore`, { method: 'POST' }),
    markups: (id: string) => this.get(`/api/documents/${id}/markups`),
    createMarkup: (id: string, data: unknown) => this.post(`/api/documents/${id}/markups`, data),
    updateMarkup: (id: string, markupId: string, data: unknown) => this.put(`/api/documents/${id}/markups/${markupId}`, data),
    deleteMarkup: (id: string, markupId: string) => this.request(`/api/documents/${id}/markups/${markupId}`, { method: 'DELETE' }),
  }

  time = {
    list: (params?: ListParams) => this.get('/api/time', params),
    summary: (params?: ListParams) => this.get('/api/time/summary', params),
    create: (data: unknown) => this.create('/api/time', data),
    update: (id: string, data: unknown) => this.update('/api/time', id, data),
    delete: (id: string) => this.delete('/api/time', id),
    approve: (id: string) => this.action('/api/time', id, 'approve'),
  }

  expenses = {
    list: (params?: ListParams) => this.get('/api/expenses', params),
    summary: (params?: ListParams) => this.get('/api/expenses/summary', params),
    create: (data: unknown) => this.create('/api/expenses', data),
    update: (id: string, data: unknown) => this.update('/api/expenses', id, data),
    delete: (id: string) => this.delete('/api/expenses', id),
    reimburse: (id: string) => this.action('/api/expenses', id, 'reimburse'),
  }

  purchaseOrders = {
    list: (params?: ListParams) => this.get('/api/purchase-orders', params),
    summary: () => this.get('/api/purchase-orders/summary'),
    get: (id: string) => this.getOne('/api/purchase-orders', id),
    create: (data: unknown) => this.create('/api/purchase-orders', data),
    update: (id: string, data: unknown) => this.update('/api/purchase-orders', id, data),
    delete: (id: string) => this.delete('/api/purchase-orders', id),
    send: (id: string) => this.action('/api/purchase-orders', id, 'send'),
    receive: (id: string) => this.action('/api/purchase-orders', id, 'receive'),
    cancel: (id: string) => this.action('/api/purchase-orders', id, 'cancel'),
    reopen: (id: string) => this.action('/api/purchase-orders', id, 'reopen'),
  }

  bills = {
    list: (params?: ListParams) => this.get('/api/bills', params),
    summary: () => this.get('/api/bills/summary'),
    jobSummary: (jobId: string) => this.get(`/api/bills/summary/job/${jobId}`),
    create: (data: unknown) => this.create('/api/bills', data),
    update: (id: string, data: unknown) => this.update('/api/bills', id, data),
    delete: (id: string) => this.delete('/api/bills', id),
    recordPayment: (id: string, amount: number) => this.action('/api/bills', id, 'record-payment', { amount }),
    void: (id: string) => this.action('/api/bills', id, 'void'),
  }

  vendorPortal = {
    invite: (contactId: string) => this.request(`/api/vendor-portal/contacts/${contactId}/invite`, { method: 'POST' }),
  }

  rfis = {
    list: (params?: ListParams) => this.get('/api/rfis', params),
    get: (id: string) => this.getOne('/api/rfis', id),
    create: (data: unknown) => this.create('/api/rfis', data),
    update: (id: string, data: unknown) => this.update('/api/rfis', id, data),
    delete: (id: string) => this.delete('/api/rfis', id),
    respond: (id: string, data: unknown) => this.action('/api/rfis', id, 'respond', data),
    close: (id: string) => this.action('/api/rfis', id, 'close'),
  }

  changeOrders = {
    list: (params?: ListParams) => this.get('/api/change-orders', params),
    get: (id: string) => this.getOne('/api/change-orders', id),
    create: (data: unknown) => this.create('/api/change-orders', data),
    update: (id: string, data: unknown) => this.update('/api/change-orders', id, data),
    delete: (id: string) => this.delete('/api/change-orders', id),
    submit: (id: string) => this.action('/api/change-orders', id, 'submit'),
    approve: (id: string, data: unknown) => this.action('/api/change-orders', id, 'approve', data),
    reject: (id: string) => this.action('/api/change-orders', id, 'reject'),
  }

  punchLists = {
    list: (params?: ListParams) => this.get('/api/punch-lists', params),
    get: (id: string) => this.getOne('/api/punch-lists', id),
    create: (data: unknown) => this.create('/api/punch-lists', data),
    update: (id: string, data: unknown) => this.update('/api/punch-lists', id, data),
    delete: (id: string) => this.delete('/api/punch-lists', id),
    complete: (id: string) => this.action('/api/punch-lists', id, 'complete'),
    verify: (id: string, data: unknown) => this.action('/api/punch-lists', id, 'verify', data),
  }

  dailyLogs = {
    list: (params?: ListParams) => this.get('/api/daily-logs', params),
    get: (id: string) => this.getOne('/api/daily-logs', id),
    create: (data: unknown) => this.create('/api/daily-logs', data),
    update: (id: string, data: unknown) => this.update('/api/daily-logs', id, data),
    delete: (id: string) => this.delete('/api/daily-logs', id),
  }

  inspections = {
    list: (params?: ListParams) => this.get('/api/inspections', params),
    create: (data: unknown) => this.create('/api/inspections', data),
    update: (id: string, data: unknown) => this.update('/api/inspections', id, data),
    delete: (id: string) => this.delete('/api/inspections', id),
    pass: (id: string) => this.action('/api/inspections', id, 'pass'),
    fail: (id: string, data: unknown) => this.action('/api/inspections', id, 'fail', data),
  }

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
  }

  team = {
    list: (params?: ListParams) => this.get('/api/team', params),
    get: (id: string) => this.getOne('/api/team', id),
    create: (data: unknown) => this.create('/api/team', data),
    update: (id: string, data: unknown) => this.update('/api/team', id, data),
    delete: (id: string) => this.delete('/api/team', id),
  }

  company = {
    get: () => this.get('/api/company'),
    update: (data: unknown) => this.put('/api/company', data),
    updateFeatures: (features: string[]) => this.put('/api/company/features', { features }),
    featureCatalog: () => this.get('/api/company/features/catalog'),
    users: () => this.get('/api/company/users'),
    createUser: (data: unknown) => this.post('/api/company/users', data),
    updateUser: (id: string, data: unknown) => this.put(`/api/company/users/${id}`, data),
    deleteUser: (id: string) => this.request(`/api/company/users/${id}`, { method: 'DELETE' }),
  }

  dashboard = {
    stats: () => this.get('/api/dashboard/stats'),
    recentActivity: () => this.get('/api/dashboard/recent-activity'),
  }
}

export function createApiClient(options: ApiClientOptions = {}) { return new ApiClient(options) }

/** The app-wide singleton; the template's services/api.ts re-exports it. */
export const api = new ApiClient()
