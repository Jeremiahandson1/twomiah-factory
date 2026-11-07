// WHO SEES A PRICE IN THE SALON. (Owner's decision, 2026-10-29: a stylist does not see prices — phone or desktop.)
//
// The seat that reads prices is the seat that reads invoices (`invoices:read`): the same question the dashboard's takings, the
// client's lifetime value and Reports already ask, so there is one answer for "may this seat see what the salon charges". A
// stylist (the staff rung) does not hold it, so every price key is LEFT OUT of what the server sends them — never zeroed
// ("$0.00" would be a different wrong answer) — and a price they send is ignored: the visit is still billed, from the
// service menu's own price (visit.ts closeVisit), by the server. Front Desk (the viewer rung) holds invoices:read and sees all.
import { eq, and } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import { serviceMenu } from '../../db/schema/index.ts'

/** Every key that is a price the salon charges or sells at. */
export const PRICE_KEYS = ['priceCharged', 'quotedPrice', 'price', 'priceIsFrom', 'planPrice', 'lifetimeValue', 'revenue'] as const

/** `value` with every price key removed, at any depth. Arrays and plain objects only; dates and primitives pass through. */
export function withoutPrices<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => withoutPrices(v)) as unknown as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!(PRICE_KEYS as readonly string[]).includes(k)) out[k] = withoutPrices(v)
    return out as T
  }
  return value
}

type CanSee = (role: string, permission: string, userId?: string) => Promise<boolean>

/** May this seat see prices? */
export const maySeePrices = (canSee: CanSee, u: { role?: string; userId?: string } | undefined) => canSee(u?.role ?? '', 'invoices:read', u?.userId)

/** For a mount: a JSON answer to a seat that may not see prices has none of them in it. */
export function pricesOnlyForMoneySeats(canSee: CanSee): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const u = c.get('user' as never) as { role?: string; userId?: string } | undefined
    if (!u || (await maySeePrices(canSee, u))) return
    if (!String(c.res.headers.get('content-type') || '').includes('application/json')) return
    const body = await c.res.clone().json().catch(() => undefined)
    if (body === undefined) return
    const headers = new Headers(c.res.headers)
    headers.delete('content-length')
    c.res = new Response(JSON.stringify(withoutPrices(body)), { status: c.res.status, headers })
  }
}

/** What the menu says a service costs — the price a seat that may not see prices books and bills at. */
export async function menuPrice(db: any, companyId: string, serviceId: string | null | undefined): Promise<string | null> {
  if (!serviceId) return null
  const [svc] = await db.select({ price: serviceMenu.price }).from(serviceMenu).where(and(eq(serviceMenu.id, serviceId), eq(serviceMenu.companyId, companyId))).limit(1)
  return svc?.price != null && Number(svc.price) > 0 ? String(svc.price) : null
}
