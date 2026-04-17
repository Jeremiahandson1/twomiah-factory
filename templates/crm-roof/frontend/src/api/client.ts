/**
 * Simple API client wrapper — provides authenticated fetch with JSON handling.
 */

function getToken(): string | null {
  return localStorage.getItem('token')
}

async function request(url: string, options: RequestInit = {}): Promise<any> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    const text = await res.text()
    let msg = text
    try { msg = JSON.parse(text).error || text } catch {}
    throw new Error(msg)
  }
  if (res.status === 204) return null
  return res.json()
}

const api = {
  get: (url: string) => request(url),
  post: (url: string, data?: any) => request(url, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: (url: string, data?: any) => request(url, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  patch: (url: string, data?: any) => request(url, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  delete: (url: string) => request(url, { method: 'DELETE' }),
}

export default api
