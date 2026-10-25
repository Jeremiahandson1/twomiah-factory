// /api/public/food — food service's public answers, no sign-in: a guest's receipt by its private link (and the Print
// button's script), and the website's pickup ordering — what can be ordered and when, placing an order (a Stripe
// Checkout page on the business's own account), and the order's word once the guest is back from paying. The company
// is the oldest row in this database (one business per tenant database).
import { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import { fail, one } from '../../http/reply.ts'
import { createRateLimiter } from '../../http/guards.ts'
import { siteOrigin } from '../../site/render.ts'
import type { CrmDeps } from '../deps.ts'
import { checkIdFromToken, RECEIPT_JS } from './barReceipts.ts'
import { CheckError } from './barRegister.ts'
import type { BarServices } from './services.ts'

const NOT_FOUND = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt not found</title></head><body style="font:16px system-ui,sans-serif;padding:24px;color:#111;background:#fff"><h1 style="font-size:20px">That receipt link does not work</h1><p>Ask the business to send it again.</p></body></html>'

export function createBarFoodPublicRoutes(d: CrmDeps, bar: BarServices) {
  const app = new Hono()
  const theCompany = async () => (await d.db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1))[0]?.id as string | undefined

  app.get('/receipt.js', (c) => c.body(RECEIPT_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }))

  app.get('/receipt/:token', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    c.header('X-Robots-Tag', 'noindex')
    const checkId = checkIdFromToken(c.req.param('token'))
    const companyId = await theCompany()
    if (!checkId || !companyId || !(await d.features.isFeatureEnabled(companyId, 'bar_register'))) return c.html(NOT_FOUND, 404)
    const html = await bar.receipts.page(companyId, checkId)
    return html ? c.html(html) : c.html(NOT_FOUND, 404)
  })

  // ── Pickup ordering (the website's /order page reads these) ──
  /** The menu, the kitchen's pickup times and the delivery links; 404 when the business offers neither. */
  app.get('/ordering', async (c) => {
    const companyId = await theCompany()
    if (!companyId) return fail(c, 404, 'Not set up yet')
    const a = await bar.orders.availability(companyId)
    if (!a.offered && !a.delivery.length) return fail(c, 404, 'Not available')
    const [co] = await d.db.select({ name: company.name, phone: company.phone }).from(company).where(eq(company.id, companyId)).limit(1)
    c.header('Cache-Control', 'no-store')
    return one(c, { ...a, menu: a.offered ? await bar.orders.onlineMenu(companyId) : [], taxRateBps: await bar.register.taxRateBps(companyId), business: { name: co?.name || '', phone: co?.phone || null } })
  })
  // Placing an order: a guest's phone, no sign-in — 20 tries per address per 10 minutes.
  app.post('/orders', createRateLimiter(10 * 60_000, 20), async (c) => {
    const companyId = await theCompany()
    if (!companyId || !(await d.features.isFeatureEnabled(companyId, 'online_ordering'))) return fail(c, 404, 'Not available')
    const b: Record<string, any> = await c.req.json().catch(() => ({}))
    try {
      const ip = (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || null
      return one(c, await bar.orders.placeOnline(companyId, { lines: b.lines, name: b.name, phone: b.phone, email: b.email, textOk: b.smsConsent ?? b.textOk, pickupAt: b.pickupAt }, siteOrigin(c), ip))
    } catch (e: any) {
      if (e instanceof CheckError) return fail(c, e.status as any, e.message)
      d.logger.error('[orders] place', { error: e?.message || String(e) })
      return fail(c, 500, 'The order did not go through. Try again.')
    }
  })
  /** Back from Stripe: the order as it stands (Stripe is asked whether it is paid). Only what the guest gave and bought. */
  app.get('/orders/confirm', async (c) => {
    const companyId = await theCompany()
    const sid = c.req.query('session_id') || ''
    if (!companyId || !/^cs_[A-Za-z0-9_]{6,200}$/.test(sid)) return fail(c, 404, 'That order is not here.')
    const o = await bar.orders.confirmSession(companyId, sid)
    if (!o) return fail(c, 404, 'That order is not here.')
    c.header('Cache-Control', 'no-store')
    const tz = await bar.reports.barTimezone(companyId)
    const pickup = o.pickupAt ? new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(o.pickupAt)) : null
    return one(c, { order: { number: o.number, name: o.name, status: o.status, lines: o.lines.map((l) => ({ name: l.name, size: l.size, qty: l.qty, note: l.note, unitPriceCents: l.unitPriceCents })), subtotalCents: o.subtotalCents, taxCents: o.taxCents, totalCents: o.totalCents, pickup } })
  })

  return app
}
