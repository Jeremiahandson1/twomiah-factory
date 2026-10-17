// Input/output hygiene for free-text fields (propagated from crm-dispensary QA F-09: names stored
// with raw <img onerror=…> / <script> markup). React escapes on render, but server-rendered pages,
// PDFs, emails and CSV exports are NOT React — strip markup on the way IN and escape on the way OUT.
import { z } from 'zod'

/** Remove HTML tags/comments (script/style blocks with their contents) and collapse whitespace. */
export function stripHtml(value: string): string {
  return String(value)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/<\/?[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** zod string that strips markup; `min` > 0 rejects values that were ONLY markup. */
export const cleanText = (min = 0) => z.string().transform(stripHtml).pipe(min > 0 ? z.string().min(min) : z.string())

/** Escape a value for interpolation into HTML (receipts, public pages, emails). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Shallow-escape every string field of a row before it is interpolated into HTML. */
export function escapeRow<T extends Record<string, any>>(row: T, skip: string[] = []): T {
  if (!row || typeof row !== 'object') return row
  const out: any = Array.isArray(row) ? [...row] : { ...row }
  for (const k of Object.keys(out)) if (typeof out[k] === 'string' && !skip.includes(k)) out[k] = escapeHtml(out[k])
  return out
}

/** Escape a CSV cell (quotes, delimiters, newlines, and formula-injection prefixes). */
export function escapeCsv(value: unknown): string {
  let s = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}
