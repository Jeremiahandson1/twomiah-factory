// One rate limiter for this tenant: the app-wide buckets in index.ts and the tighter ones the anonymous
// kiosk endpoints need. It lived inside index.ts, which a route file cannot import (index imports the
// routes), so the kiosk would otherwise have grown a third copy — website-analytics.ts already has a second.
import type { Context, Next } from 'hono'

/**
 * Fixed-window limiter, counted per client address.
 *
 * Key on the CLIENT address ONLY. x-forwarded-for is "client, hop, hop" and Render's edge appends a varying
 * hop, so keying on the whole header gave every request its own counter — 30 wrong passwords in a row never
 * hit the limit. (SALON-H5)
 */
export function createRateLimiter(windowMs: number, max: number, countMethod?: (m: string) => boolean) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return async (c: Context, next: Next) => {
    if (countMethod && !countMethod(c.req.method)) return next()
    const key = clientKey(c)
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
    } else {
      entry.count++
      if (entry.count > max) {
        return c.json({ error: 'Too many requests, please try again later' }, 429)
      }
    }
    await next()
  }
}

export const clientKey = (c: Context) =>
  c.req.header('cf-connecting-ip') || (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'

export const isWrite = (m: string) => m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'

/**
 * The kiosk is anonymous BY DESIGN — a customer stands at the device and there is no one to sign in — so the
 * protection here cannot be authentication. What it can do is stop the open internet using an anonymous
 * endpoint as a firehose: the app-wide write bucket allows 1,200 writes per 15 minutes, which is 1,200
 * fabricated orders. These buckets are per client address and sized for a BUSY SHOP (four a minute sustained,
 * shared by everyone behind the shop's one public address), not for one customer.
 *
 * This is mitigation, not a cure. An attacker who spreads requests across addresses still gets through; the
 * real answer is enrolling the device and giving it a credential, which is a product decision rather than a
 * patch. What it does buy: the damage is bounded, and kiosk orders land as `pending` for a budtender to
 * settle at the register, so nothing here books money on its own. (Dispensary T20 B2)
 */
export const KIOSK_WINDOW_MS = 15 * 60 * 1000
export const KIOSK_MAX_SESSIONS = 60
export const KIOSK_MAX_CHECKOUTS = 60
