/**
 * Simple API client wrapper — provides authenticated fetch with JSON handling.
 *
 * The request goes through services/api's raw(), the one place the bearer is added: read at the moment of the call,
 * and refreshed and retried when it has expired. This wrapper used to read the token and call fetch() itself, so an
 * expired token here was a failed request with nothing to recover it. (10/14)
 */
import client from '../services/api'

async function request(url: string, options: RequestInit = {}): Promise<any> {
  const res = await client.raw(url, options as RequestInit & { headers?: Record<string, string> })
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
