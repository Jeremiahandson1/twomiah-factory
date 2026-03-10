const API_BASE = import.meta.env.VITE_API_URL || ''

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

  async fetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers })

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
  }

  get<T = any>(path: string): Promise<T> {
    return this.fetch<T>(path)
  }

  post<T = any>(path: string, body: any): Promise<T> {
    return this.fetch<T>(path, { method: 'POST', body: JSON.stringify(body) })
  }

  put<T = any>(path: string, body: any): Promise<T> {
    return this.fetch<T>(path, { method: 'PUT', body: JSON.stringify(body) })
  }

  del<T = any>(path: string): Promise<T> {
    return this.fetch<T>(path, { method: 'DELETE' })
  }

  async upload<T = any>(path: string, file: File): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    })
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
