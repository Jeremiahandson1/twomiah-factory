// Home care's screens reach the server through the app's one client (web/src/api.ts): the session is the server's
// httpOnly cookies, refreshed underneath, so no screen holds or sends a token (the template passed `token` to every
// call and read it from localStorage). Replies follow RULEBOOK §3: a list is { data, pagination }, a record is the
// object, a refusal is { error, code? } thrown as an Error whose message is the server's sentence.
import { api } from '../../../../api'

export { api }
export type { RequestOptions } from '@twomiah/tenant-ui/src/api/client'

/** A file the server sends (a PDF, an export, an attachment), or the server's reason as the Error. */
export async function downloadBlob(endpoint: string): Promise<Blob> {
  const res = await api.raw(endpoint)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || 'Download failed')
  }
  return res.blob()
}

/** Like downloadBlob, with the file name the server chose (Content-Disposition) — for files whose name matters, such as payroll files. */
export async function downloadFile(endpoint: string): Promise<{ blob: Blob; fileName: string | null }> {
  const res = await api.raw(endpoint)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || 'Download failed')
  }
  const named = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '')
  return { blob: await res.blob(), fileName: named?.[1] ?? null }
}

/** Hands a Blob to the browser as a download named `fileName`. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** The rows of a list reply ({ data, pagination }); [] for anything else, so a refused or empty answer renders empty. */
export function rows<T = any>(reply: unknown): T[] {
  const data = (reply as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

/** The most rows one request may ask for (the server's paging guard, server/http/guards.ts: ?limit over 500 is a 400). */
export const PAGE_LIMIT = 500

/**
 * Every row of a paged list endpoint — a picker's whole list — walking the pages until the server says there are no
 * more, answered as one list reply ({ data, pagination }) so a screen reads it with rows() like any other. The
 * template's screens asked for ?limit=1000 in one go; the server caps a page at 500, so that request was refused
 * outright and the picker came up empty (found in the browser, 2026-10-19), and an agency with more than a page would
 * have lost the rest silently either way.
 */
export async function listAll<T = any>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<{ data: T[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  const data: T[] = []
  for (let page = 1; page <= 1000; page++) {
    const reply = await api.get(path, { ...params, page, limit: PAGE_LIMIT } as any)
    const got = rows<T>(reply)
    data.push(...got)
    const pages = Number((reply as { pagination?: { pages?: number } } | null)?.pagination?.pages ?? 1)
    if (!got.length || page >= pages) break
  }
  return { data, pagination: { page: 1, limit: data.length, total: data.length, pages: 1 } }
}

/** The message to show for a failed call. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return err instanceof Error && err.message ? err.message : fallback
}
