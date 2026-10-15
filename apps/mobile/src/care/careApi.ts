/**
 * Requests for the caregiver screens. Same API client (base URL, JWT, 401 refresh) as the rest of
 * the app, plus the one guarantee a caregiver needs: a request ALWAYS settles. A stalled request
 * (TCP open, no answer — common on weak mobile data at a client's house) is aborted after a timeout
 * and comes back as status 0, so no clock button can spin forever and the punch can be saved on the
 * phone instead. Never throws.
 */
import { api, type ApiResponse } from '../api/client'
import type { PunchSender } from './offlinePunches'

export type CareRes<T = any> = ApiResponse<T>

export async function careRequest<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, timeoutMs = 20000): Promise<CareRes<T>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await api<T>(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e: any) {
    const aborted = e?.name === 'AbortError' || ctrl.signal.aborted
    return { ok: false, status: 0, data: null as any, error: aborted ? 'Request timed out — check your connection and try again.' : 'No connection — check your signal and try again.' }
  } finally {
    clearTimeout(timer)
  }
}

export const careGet = <T = any>(path: string, timeoutMs?: number) => careRequest<T>('GET', path, undefined, timeoutMs)
export const carePost = <T = any>(path: string, body?: unknown, timeoutMs?: number) => careRequest<T>('POST', path, body ?? {}, timeoutMs)
export const carePut = <T = any>(path: string, body?: unknown) => careRequest<T>('PUT', path, body ?? {})
export const carePatch = <T = any>(path: string, body?: unknown) => careRequest<T>('PATCH', path, body ?? {})

/** GET with retries on a dropped connection or a server blip (never on a 4xx — that won't fix itself). */
export async function careGetRetry<T = any>(path: string, tries = 3): Promise<CareRes<T>> {
  let last: CareRes<T> = { ok: false, status: 0, data: null as any }
  for (let attempt = 1; attempt <= tries; attempt++) {
    last = await careGet<T>(path)
    if (last.ok || (last.status >= 400 && last.status < 500 && last.status !== 429)) return last
    if (attempt < tries) await new Promise((r) => setTimeout(r, 800 * attempt))
  }
  return last
}

/** The offline-punch transport. */
export const punchSender: PunchSender = async (path, body) => {
  const r = await careRequest('POST', path, body)
  return { status: r.status, data: r.data }
}

/** A list response that may be a bare array or wrapped ({ data } / { entries } / …). */
export function asList<T = any>(data: any, ...keys: string[]): T[] {
  if (Array.isArray(data)) return data
  for (const k of keys) if (data && Array.isArray(data[k])) return data[k]
  return []
}
