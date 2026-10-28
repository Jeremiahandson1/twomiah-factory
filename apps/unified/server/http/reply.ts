// The four reply shapes (RULEBOOK §3). Server code replies only through these, so a screen always knows what it
// gets back. They are the shapes the shared packages already use.
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * An error: `{ error, code?, fields? }` with a 4xx/5xx status. `error` is a sentence a person can read; `fields`
 * names each wrong box on a validation failure.
 */
export function fail(c: Context, status: ContentfulStatusCode, error: string, code?: string, fields?: Record<string, string>) {
  return c.json({ error, ...(code ? { code } : {}), ...(fields ? { fields } : {}) }, status)
}

/** A page of records: `{ data, pagination: { page, limit, total, pages } }`. */
export function list<T>(c: Context, data: T[], page: { page: number; limit: number; total: number }) {
  const pages = page.limit > 0 ? Math.ceil(page.total / page.limit) : 0
  return c.json({ data, pagination: { page: page.page, limit: page.limit, total: page.total, pages } })
}

/** The page size a list serves when the caller names none — the paged lists' own default (`q.limit || '50'`). */
export const DEFAULT_PAGE_LIMIT = 50

/**
 * A whole list (no paging on the server): every row, on page 1. Its `limit` is the limit the caller asked for, else the
 * server's default page size (DEFAULT_PAGE_LIMIT), or the number returned if that is more — never a made-up 1 for an
 * empty list (live test 2026-10-22), and never the row count passed off as a limit (HVAC re-test T25 L5: services with
 * 2 rows said limit 2; an empty list said 0).
 */
export function listAll<T>(c: Context, data: T[]) {
  return list(c, data, allPagination(c, data.length))
}
/** The `pagination` of a whole list (see listAll) — for a reply that carries more than the rows (a sum beside them). */
export function allPagination(c: Context, rows: number) {
  const asked = Number(c.req.query('limit'))
  const limit = Math.max(Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_PAGE_LIMIT, rows)
  return { page: 1, limit, total: rows }
}

/** One record, as it is. */
export function one<T extends object>(c: Context, record: T, status: ContentfulStatusCode = 200) {
  return c.json(record, status)
}

/** An action with nothing to return; `message` when the screen shows the person a sentence. */
export function done(c: Context, message?: string) {
  return c.json(message ? { success: true as const, message } : { success: true as const })
}
