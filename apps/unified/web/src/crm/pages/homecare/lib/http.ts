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

/** The message to show for a failed call. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return err instanceof Error && err.message ? err.message : fallback
}
