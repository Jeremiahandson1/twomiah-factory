// The request guards every CRM template ran in front of its routes (the eight newer templates' index.ts): the
// content security policy, the paging check and the rate limits.
import type { Context, MiddlewareHandler, Next } from 'hono'
import { fail } from './reply.ts'

// The screens are served from this origin as external bundles (no inline scripts). Third-party script surfaces:
// Stripe, Google Maps (address autocomplete), Leaflet from unpkg. Images and connections stay broad because media
// lives on R2 and customer URLs, and the API host can differ from the page host on a custom domain.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com https://maps.googleapis.com https://maps.gstatic.com https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss:",
  // 'self': the website editor shows the site itself in a frame (web/src/site/pages/PageEditPage.tsx).
  "frame-src 'self' blob: https://js.stripe.com https://hooks.stripe.com https://www.google.com https://maps.google.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  'upgrade-insecure-requests',
].join('; ')

/** Sets the policy on any response that didn't set its own. */
export const contentSecurityPolicy: MiddlewareHandler = async (c, next) => {
  await next()
  if (!c.res.headers.has('Content-Security-Policy')) c.res.headers.set('Content-Security-Policy', CSP)
}

const MAX_PAGE_LIMIT = 500

/** ?page and ?limit must be whole numbers, limit at most 500: page=-1 made a negative OFFSET, limit had no cap. */
export const pagingGuard: MiddlewareHandler = async (c, next) => {
  const pageRaw = c.req.query('page')
  const limitRaw = c.req.query('limit')
  const isPosInt = (v: string) => /^\d+$/.test(v) && Number(v) >= 1
  if (pageRaw !== undefined && pageRaw !== '' && !isPosInt(pageRaw)) {
    return fail(c, 400, 'Invalid page: must be an integer ≥ 1', 'invalid_pagination')
  }
  if (limitRaw !== undefined && limitRaw !== '' && (!isPosInt(limitRaw) || Number(limitRaw) > MAX_PAGE_LIMIT)) {
    return fail(c, 400, `Invalid limit: must be an integer between 1 and ${MAX_PAGE_LIMIT}`, 'invalid_pagination')
  }
  await next()
}

export const isWrite = (m: string) => m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'

/**
 * A per-address request ceiling over a window. Keyed on the client address only: x-forwarded-for is
 * "client, hop, hop" and Render's edge appends a varying hop, so keying on the whole header gave every request its
 * own counter. Tells the browser its limit, what remains and when to retry.
 */
export function createRateLimiter(windowMs: number, max: number, countMethod?: (m: string) => boolean): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of hits) if (now > entry.resetAt) hits.delete(key)
  }, windowMs)
  // The sweep is housekeeping; it must not keep a test run or a shutdown alive.
  ;(sweep as any).unref?.()

  return async (c: Context, next: Next) => {
    if (countMethod && !countMethod(c.req.method)) return next()
    const key = c.req.header('cf-connecting-ip') || (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
    const now = Date.now()
    let entry = hits.get(key)
    if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + windowMs }; hits.set(key, entry) }
    entry.count++
    c.header('RateLimit-Limit', String(max))
    c.header('RateLimit-Remaining', String(Math.max(0, max - entry.count)))
    if (entry.count > max) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))))
      return fail(c, 429, 'Too many requests, please try again later')
    }
    await next()
  }
}
