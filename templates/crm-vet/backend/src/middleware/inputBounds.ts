import type { Context, Next } from 'hono'

// Hard ceiling on any single text field in a JSON write body. Prevents a
// 10,000+ char "name" (which breaks table layout downstream) and unbounded input
// generally. Free-text notes get more headroom via MAX_LONG.
const MAX_LONG = parseInt(process.env.MAX_INPUT_STRING || '') || 20000

function findTooLong(v: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (typeof v === 'string') return v.length > MAX_LONG
  if (Array.isArray(v)) return v.some((x) => findTooLong(x, depth + 1))
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).some((x) => findTooLong(x, depth + 1))
  return false
}

/**
 * Reject any JSON write whose body carries a string longer than MAX_LONG.
 * Applies only to JSON requests (multipart uploads are handled by the file
 * validator). Hono caches the parsed body, so downstream handlers still read it.
 */
export async function boundInputLengths(c: Context, next: Next) {
  const method = c.req.method
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const ct = c.req.header('content-type') || ''
    if (ct.includes('application/json')) {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        // Malformed/empty body — let the route handle it.
        return next()
      }
      if (findTooLong(body)) {
        return c.json({ error: `A text field exceeds the ${MAX_LONG.toLocaleString()}-character limit.` }, 400)
      }
    }
  }
  await next()
}
