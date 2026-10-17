/**
 * API Client — handles all HTTP requests to the deployed CRM backend.
 * Manages JWT token refresh automatically.
 */

import * as SecureStore from 'expo-secure-store'

const KEYS = {
  ACCESS_TOKEN: 'twomiah_access_token',
  REFRESH_TOKEN: 'twomiah_refresh_token',
  API_URL: 'twomiah_api_url',
} as const

let accessToken: string | null = null
let refreshToken: string | null = null
let apiUrl: string = ''
let refreshPromise: Promise<boolean> | null = null

// ── Token Storage ────────────────────────────────────────────────────────────

export async function loadTokens() {
  accessToken = await SecureStore.getItemAsync(KEYS.ACCESS_TOKEN)
  refreshToken = await SecureStore.getItemAsync(KEYS.REFRESH_TOKEN)
  apiUrl = (await SecureStore.getItemAsync(KEYS.API_URL)) || ''
}

export async function saveTokens(access: string, refresh: string) {
  accessToken = access
  refreshToken = refresh
  await SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, access)
  await SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, refresh)
}

export async function saveApiUrl(url: string) {
  apiUrl = url.replace(/\/$/, '')
  await SecureStore.setItemAsync(KEYS.API_URL, apiUrl)
}

export async function clearTokens() {
  accessToken = null
  refreshToken = null
  await SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN)
  await SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN)
}

export function getAccessToken() { return accessToken }
export function getRefreshToken() { return refreshToken }
export function getApiUrl() { return apiUrl }

// ── Token Refresh ────────────────────────────────────────────────────────────

async function doRefresh(): Promise<boolean> {
  if (!refreshToken || !apiUrl) return false
  try {
    const res = await fetch(`${apiUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) return false
    const data = await res.json()
    await saveTokens(data.accessToken, data.refreshToken)
    return true
  } catch {
    return false
  }
}

async function refreshIfNeeded(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = doRefresh().finally(() => { refreshPromise = null })
  return refreshPromise
}

// ── Fetch Wrapper ────────────────────────────────────────────────────────────

export interface ApiResponse<T = any> {
  ok: boolean
  status: number
  data: T
  error?: string
}

export async function api<T = any>(
  path: string,
  opts: RequestInit = {},
  { refreshOn401 = true }: { refreshOn401?: boolean } = {},
): Promise<ApiResponse<T>> {
  if (!apiUrl) return { ok: false, status: 0, data: null as any, error: 'No API URL configured' }

  const url = `${apiUrl}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> || {}),
  }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  let res = await fetch(url, { ...opts, headers })

  // Auto-refresh on 401 — except on the sign-in doors, where a 401 is the ANSWER (wrong password,
  // wrong code), not an expired token. Retrying POST /api/auth/mfa with a left-over refresh token sent
  // the same wrong code twice and spent two of the challenge's five tries.
  if (res.status === 401 && refreshToken && refreshOn401) {
    const refreshed = await refreshIfNeeded()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`
      res = await fetch(url, { ...opts, headers })
    }
  }

  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text()

  if (!res.ok) {
    return { ok: false, status: res.status, data: data as T, error: data?.error || `HTTP ${res.status}` }
  }
  return { ok: true, status: res.status, data: data as T }
}

// ── File Upload ─────────────────────────────────────────────────────────────

export async function upload<T = any>(
  path: string,
  formData: FormData,
): Promise<ApiResponse<T>> {
  if (!apiUrl) return { ok: false, status: 0, data: null as any, error: 'No API URL configured' }

  const url = `${apiUrl}${path}`
  const headers: Record<string, string> = {}
  // Do NOT set Content-Type — let RN set the multipart boundary automatically
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  let res = await fetch(url, { method: 'POST', headers, body: formData })

  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshIfNeeded()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`
      res = await fetch(url, { method: 'POST', headers, body: formData })
    }
  }

  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text()

  if (!res.ok) {
    return { ok: false, status: res.status, data: data as T, error: data?.error || `HTTP ${res.status}` }
  }
  return { ok: true, status: res.status, data: data as T }
}

/** Upload photos for a job/lead/contact */
export function uploadPhotos(entityId: string, entityType: 'jobId' | 'leadId' | 'contactId', photos: { uri: string; name?: string }[]) {
  const fd = new FormData()
  fd.append(entityType, entityId)
  photos.forEach((photo, i) => {
    fd.append('photos', {
      uri: photo.uri,
      type: 'image/jpeg',
      name: photo.name || `photo_${Date.now()}_${i}.jpg`,
    } as any)
  })
  return upload('/api/photos/bulk', fd)
}

// ── Convenience Methods ──────────────────────────────────────────────────────

export const get = <T = any>(path: string) => api<T>(path)
export const post = <T = any>(path: string, body?: any) =>
  api<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
/** POST to a sign-in door (/api/auth/login, /api/auth/mfa): its 401 is an answer, so no token refresh and retry. */
export const postSignIn = <T = any>(path: string, body: any) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) }, { refreshOn401: false })
export const put = <T = any>(path: string, body?: any) =>
  api<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined })
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' })
