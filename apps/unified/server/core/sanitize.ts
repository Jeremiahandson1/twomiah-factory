// Free-text hygiene, moved from templates/crm*/backend/src/utils/sanitize.ts: strip markup on the way in, escape on
// the way out (server-rendered pages, PDFs, emails and CSV exports are not React).
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

/** zod string that strips markup; `min` > 0 rejects values that were ONLY markup. One line: every run of whitespace,
 * line breaks included, becomes one space — for names, titles, addresses. */
export const cleanText = (min = 0) => z.string().transform(stripHtml).pipe(min > 0 ? z.string().min(min) : z.string())

/** Markup stripped as stripHtml does, but the person's line breaks kept: spaces within a line collapse, each line is
 * trimmed, and a run of blank lines becomes one. For notes and descriptions (a job's notes typed on the phone as a
 * list came back as one run-on line, 2026-10-19). */
export function stripHtmlKeepLines(value: string): string {
  const text = String(value)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/<\/?[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/\r\n?/g, '\n')
  return text.split('\n').map((line) => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** cleanText for a multi-line field (notes, description): markup stripped, line breaks kept. */
export const cleanLines = (min = 0) => z.string().transform(stripHtmlKeepLines).pipe(min > 0 ? z.string().min(min) : z.string())

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
