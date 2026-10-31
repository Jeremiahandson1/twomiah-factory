/**
 * Offline-aware writes for screens: `post` / `put` / `patch` / `del` go now when they can and are kept when they cannot.
 * `queued: true` means "saved on the phone, will be sent" — show it as waiting to send, not as done. A refusal (4xx) is
 * NOT queued: it comes back as `ok: false` with the server's words, for the screen to show. See ./README.md.
 */

import { OfflineQueue, type Method } from './OfflineQueue'
import type { ApiResponse } from '../api/client'

export interface WriteOptions { recordKey?: string; label?: string }
export type Written<T> = ApiResponse<T> & { queued?: boolean; queueId?: string }

async function write<T>(method: Method, path: string, body: unknown, opts: WriteOptions | undefined): Promise<Written<T>> {
  const r = await OfflineQueue.submit({ method, path, body, ...opts })
  if (r.queued) return { ok: true, status: 0, data: null as any, queued: true, queueId: r.item?.id }
  const ok = r.status >= 200 && r.status < 300
  const data = r.data as T
  return { ok, status: r.status, data, ...(ok ? {} : { error: (data as any)?.error || `HTTP ${r.status}` }) }
}

export function useOfflineApi() {
  return {
    post: <T = any>(path: string, body?: unknown, opts?: WriteOptions) => write<T>('POST', path, body, opts),
    put: <T = any>(path: string, body?: unknown, opts?: WriteOptions) => write<T>('PUT', path, body, opts),
    patch: <T = any>(path: string, body?: unknown, opts?: WriteOptions) => write<T>('PATCH', path, body, opts),
    del: <T = any>(path: string, opts?: WriteOptions) => write<T>('DELETE', path, undefined, opts),
  }
}
