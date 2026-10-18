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

/** One record, as it is. */
export function one<T extends object>(c: Context, record: T, status: ContentfulStatusCode = 200) {
  return c.json(record, status)
}

/** An action with nothing to return. */
export function done(c: Context) {
  return c.json({ success: true as const })
}
