// Thin fetch wrapper for the admin JSON API. Auth is via an httpOnly
// cookie set by /api/admin/login — the browser attaches it automatically
// to every same-origin request. JavaScript can't read or set it, so XSS
// can't exfiltrate the credential. `credentials: 'include'` is required
// because we may also be deployed under a separate admin subdomain.
export class ApiError extends Error {
  status: number
  details?: any
  constructor(message: string, status: number, details?: any) {
    super(message)
    this.status = status
    this.details = details
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  let serializedBody: string | undefined
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    serializedBody = JSON.stringify(body)
  }

  const res = await fetch(path, { method, headers, body: serializedBody, credentials: 'include' })
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    const message = (data && (data.error || data.message)) || res.statusText
    throw new ApiError(message, res.status, data)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  request: <T>(method: string, path: string, body?: unknown) => request<T>(method, path, body),
}
