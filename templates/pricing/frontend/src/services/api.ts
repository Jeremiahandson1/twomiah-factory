import { getAll, getById, putItem, queueSync } from '../lib/offlineDb'

const API_BASE = import.meta.env.VITE_API_URL || ''

// Map API paths to IndexedDB store names for offline fallback
const OFFLINE_STORE_MAP: Record<string, string> = {
  '/api/pricebook/categories': 'pricebook',
  '/api/pricebook/products': 'pricebook',
  '/api/estimator/products': 'estimatorData',
  '/api/settings': 'settings',
}

class ApiClient {
  private token: string | null = localStorage.getItem('token')

  setToken(token: string | null) {
    this.token = token
    if (token) localStorage.setItem('token', token)
    else localStorage.removeItem('token')
  }

  getToken() {
    return this.token
  }

  async fetch<T = any>(path: string, options: RequestInit = {}): Promise<T & { _offline?: boolean; _cachedAt?: string }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    try {
      const res = await window.fetch(`${API_BASE}${path}`, { ...options, headers })

      if (res.status === 401) {
        this.setToken(null)
        window.location.href = '/login'
        throw new Error('Unauthorized')
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(err.error || 'Request failed')
      }

      return res.json()
    } catch (error) {
      // If offline and it's a GET, try IndexedDB
      if (!navigator.onLine && (!options.method || options.method === 'GET')) {
        return this.getOfflineFallback(path)
      }

      // If offline and it's a write operation, queue it
      if (!navigator.onLine && options.method && options.method !== 'GET') {
        await queueSync({
          method: options.method,
          url: `${API_BASE}${path}`,
          body: (options.body as string) || null,
          createdAt: new Date().toISOString(),
        })
        // Return optimistic response
        const body = options.body ? JSON.parse(options.body as string) : {}
        return { ...body, id: body.id || crypto.randomUUID(), _offline: true } as any
      }

      throw error
    }
  }

  private async getOfflineFallback<T>(path: string): Promise<T & { _offline: boolean; _cachedAt: string }> {
    // Try to find matching store
    for (const [prefix, store] of Object.entries(OFFLINE_STORE_MAP)) {
      if (path.startsWith(prefix)) {
        const data = await getAll(store)
        return { data, _offline: true, _cachedAt: new Date().toISOString() } as any
      }
    }

    // Try quotes/estimates stores
    if (path.startsWith('/api/quotes')) {
      const idMatch = path.match(/\/api\/quotes\/([^/]+)$/)
      if (idMatch) {
        const quote = await getById('quotes', idMatch[1])
        if (quote) return { data: quote, _offline: true, _cachedAt: new Date().toISOString() } as any
        throw new Error('Quote not found offline')
      }
      const quotes = await getAll('quotes')
      return { data: quotes, _offline: true, _cachedAt: new Date().toISOString() } as any
    }
    if (path.startsWith('/api/estimator/estimates')) {
      const idMatch = path.match(/\/api\/estimator\/estimates\/([^/]+)$/)
      if (idMatch) {
        const estimate = await getById('estimates', idMatch[1])
        if (estimate) return { data: estimate, _offline: true, _cachedAt: new Date().toISOString() } as any
        throw new Error('Estimate not found offline')
      }
      const estimates = await getAll('estimates')
      return { data: estimates, _offline: true, _cachedAt: new Date().toISOString() } as any
    }

    throw new Error('No offline data available')
  }

  get<T = any>(path: string) {
    return this.fetch<T>(path)
  }

  post<T = any>(path: string, body: any) {
    return this.fetch<T>(path, { method: 'POST', body: JSON.stringify(body) })
  }

  put<T = any>(path: string, body: any) {
    return this.fetch<T>(path, { method: 'PUT', body: JSON.stringify(body) })
  }

  patch<T = any>(path: string, body: any) {
    return this.fetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
  }

  del<T = any>(path: string) {
    return this.fetch<T>(path, { method: 'DELETE' })
  }

  async upload<T = any>(path: string, file: File): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    const formData = new FormData()
    formData.append('file', file)
    const res = await window.fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData })
    if (res.status === 401) {
      this.setToken(null)
      window.location.href = '/login'
      throw new Error('Unauthorized')
    }
    if (!res.ok) throw new Error('Upload failed')
    return res.json()
  }
}

export const api = new ApiClient()
