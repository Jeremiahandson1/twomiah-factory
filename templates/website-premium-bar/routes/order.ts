/**
 * routes/order.ts — pickup ordering on our own domain, plus the Square webhook.
 *
 *   GET  /order               the order page (only while ONLINE_ORDERING=on and Square is set up)
 *   GET  /order/:id           confirmation + live status (the uuid is the secret; noindex)
 *   POST /api/order/quote     cart → Square-computed tax and total (nothing created)
 *   POST /api/order/pay       cart + card token → Square order + payment
 *   GET  /api/order/:id       status for the confirmation page's poll
 *   POST /api/square/webhook  signature-verified Square events
 *
 * Never Square's hosted storefront (SPEC §1): the card form is Square's Web
 * Payments SDK iframe on this page, so card data never touches our server.
 */
import { Hono, type Context } from 'hono'
import { eq } from 'drizzle-orm'
import ejs from 'ejs'
import path from 'path'
import { db } from '../db'
import { onlineOrders, settings as settingsTbl } from '../db/schema'
import { buildLiveState } from '../lib/live'
import { bustSiteData, loadSiteData } from '../lib/site-data'
import { renderBase, viewsDir } from '../lib/render'
import { toE164 } from '../lib/sms/twilio'
import { formatCents, onlineOrderingEnabled, squareConfig, verifySquareSignature } from '../lib/square/client'
import { orderableMenu, paymentErrorMessage, placeOrder, quote, resolveCart } from '../lib/square/orders'
import { handleSquareEvent, webhookCredentials } from '../lib/square/webhook'
import { fireWebOrder } from '../lib/kitchen/tickets'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The page CSP, widened for exactly Square's Web Payments SDK hosts (developer.squareup.com/docs/web-payments/content-security-policy). */
function orderCsp(environment: 'sandbox' | 'production'): string {
  const web = environment === 'production' ? 'https://web.squarecdn.com' : 'https://sandbox.web.squarecdn.com'
  const pci = environment === 'production' ? 'https://pci-connect.squareup.com' : 'https://pci-connect.squareupsandbox.com'
  return [
    "default-src 'self'",
    "img-src 'self' data: https:",
    `font-src 'self' https://fonts.gstatic.com https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net data:`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${web}`,
    `script-src 'self' 'unsafe-inline' ${web}`,
    `connect-src 'self' ${pci} https://o160250.ingest.sentry.io`,
    `frame-src ${web}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

async function loadSettings() {
  const [s] = await db.select().from(settingsTbl).limit(1)
  return s || ({ companyName: 'The bar', nav: [] } as any)
}

// ═══════════════════════════════════════════════════════════════════════════
// Pages
// ═══════════════════════════════════════════════════════════════════════════
export const orderPages = new Hono()

orderPages.get('/', async (c, next) => {
  if (!onlineOrderingEnabled()) return next()   // no /order page until it is switched on
  const cfg = squareConfig()!
  const [settings, site] = await Promise.all([loadSettings(), loadSiteData()])
  const menu = orderableMenu(site.menu)
  const body = await ejs.renderFile(path.join(viewsDir, 'order', 'page.ejs'), {
    settings, live: site.live, menu, formatCents,
    square: { applicationId: cfg.applicationId, locationId: cfg.locationId, sdkUrl: cfg.sdkUrl, environment: cfg.environment },
  }) as string
  const html = await renderBase({
    body, currentPath: '/order',
    settings: { ...settings, seoTitle: 'Order pickup — ' + settings.companyName, seoDescription: `Order ${settings.companyName} burgers and fish fry for pickup. Paid online, ready at the bar.` },
  })
  c.header('Content-Security-Policy', orderCsp(cfg.environment))
  c.header('Cache-Control', 'no-store')
  return c.html(html)
})

orderPages.get('/:id', async (c, next) => {
  const id = c.req.param('id')
  if (!UUID.test(id)) return next()
  const [row] = await db.select().from(onlineOrders).where(eq(onlineOrders.id, id)).limit(1)
  if (!row || row.status === 'pending' || row.status === 'failed') return next()
  const settings = await loadSettings()
  const tz = settings.timezone || 'America/Chicago'
  const body = await ejs.renderFile(path.join(viewsDir, 'order', 'status.ejs'), { settings, order: row, formatCents, tz }) as string
  const html = await renderBase({ body, currentPath: '/order', settings: { ...settings, seoTitle: 'Your order — ' + settings.companyName } })
  c.header('X-Robots-Tag', 'noindex')
  c.header('Cache-Control', 'no-store')
  return c.html(html)
})

// ═══════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════
export const orderApi = new Hono()

// Per-IP limit on quote/pay: 30 requests / 10 minutes. A real customer uses a handful.
const buckets = new Map<string, number[]>()
function limited(c: Context, max = 30, windowMs = 10 * 60 * 1000): boolean {
  const ip = (c.req.header('X-Forwarded-For') || '').split(',')[0].trim() || c.req.header('CF-Connecting-IP') || 'unknown'
  const now = Date.now()
  const times = (buckets.get(ip) || []).filter(t => now - t < windowMs)
  if (times.length >= max) return true
  times.push(now); buckets.set(ip, times)
  return false
}

async function freshMenu() {
  bustSiteData()   // 86 and sold-out must be current at the moment of payment
  return orderableMenu((await loadSiteData()).menu)
}

orderApi.post('/order/quote', async (c) => {
  if (!onlineOrderingEnabled()) return c.json({ error: 'Online ordering is not open.' }, 404)
  if (limited(c)) return c.json({ error: 'Too many requests. Call the bar.' }, 429)
  const body = await c.req.json().catch(() => ({})) as Record<string, any>
  const cart = resolveCart(body.lines, await freshMenu())
  if ('error' in cart) return c.json({ error: cart.error }, 400)
  try {
    return c.json({ ok: true, ...(await quote(cart.lines)) })
  } catch (e: any) {
    console.error('[order] quote failed:', e?.message || e)
    return c.json({ error: 'Could not price the order. Try again, or call the bar.' }, 502)
  }
})

orderApi.post('/order/pay', async (c) => {
  if (!onlineOrderingEnabled()) return c.json({ error: 'Online ordering is not open.' }, 404)
  if (limited(c, 10)) return c.json({ error: 'Too many attempts. Call the bar.' }, 429)
  const body = await c.req.json().catch(() => ({})) as Record<string, any>
  const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const phone = toE164(String(body.phone || ''))
  const key = String(body.idempotencyKey || '')
  const sourceId = String(body.sourceId || '')
  if (!name) return c.json({ error: 'Put a name on the order.' }, 400)
  if (!phone) return c.json({ error: 'We need a phone number in case something is off with the order.' }, 400)
  if (!UUID.test(key) || !sourceId) return c.json({ error: 'The card form did not finish. Try again.' }, 400)

  // Same key twice (double tap, retry after a timeout) → the first result, never a second charge.
  const [prior] = await db.select().from(onlineOrders).where(eq(onlineOrders.idempotencyKey, key)).limit(1)
  if (prior && prior.status !== 'pending' && prior.status !== 'failed') return c.json({ ok: true, id: prior.id, url: '/order/' + prior.id })

  const live = await buildLiveState(db)
  if (!live.ordering.available) return c.json({ error: live.ordering.reason || 'Online ordering is closed.' }, 409)
  const cart = resolveCart(body.lines, await freshMenu())
  if ('error' in cart) return c.json({ error: cart.error }, 400)

  const lines = cart.lines.map(l => ({ itemId: l.itemId, name: l.name, variation: l.variation, qty: l.qty, note: l.note, priceCents: l.priceCents }))
  const row = prior || (await db.insert(onlineOrders).values({ idempotencyKey: key, customerName: name, phone, textUpdates: body.textUpdates === true, lines }).returning())[0]
  try {
    const r = await placeOrder({
      lines: cart.lines, name, phone, sourceId, idempotencyKey: key, referenceId: row.id,
      prepMinutes: live.ordering.prepMinutes, pickupNote: 'Website order — ' + name,
    })
    await db.update(onlineOrders).set({
      status: 'paid', squareOrderId: r.squareOrderId, squarePaymentId: r.squarePaymentId,
      subtotalCents: r.subtotalCents, taxCents: r.taxCents, totalCents: r.totalCents, pickupAt: r.pickupAt,
      customerName: name, phone, textUpdates: body.textUpdates === true, lines, error: null, updatedAt: new Date(),
    }).where(eq(onlineOrders.id, row.id))
    // Paid → straight onto the grill screen. A failure here must not look like a failed payment.
    await fireWebOrder(db, row.id).catch((e) => console.error('[order] could not fire to the grill:', e?.message || e))
    return c.json({ ok: true, id: row.id, url: '/order/' + row.id })
  } catch (e: any) {
    console.warn('[order] payment failed:', e?.message || e)
    await db.update(onlineOrders).set({ status: 'failed', error: String(e?.message || e).slice(0, 500), updatedAt: new Date() }).where(eq(onlineOrders.id, row.id))
    return c.json({ error: paymentErrorMessage(e) }, 402)
  }
})

orderApi.get('/order/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID.test(id)) return c.json({ error: 'Not found' }, 404)
  const [row] = await db.select({ status: onlineOrders.status, pickupAt: onlineOrders.pickupAt }).from(onlineOrders).where(eq(onlineOrders.id, id)).limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  c.header('Cache-Control', 'no-store')
  return c.json({ status: row.status, pickupAt: row.pickupAt })
})

orderApi.post('/square/webhook', async (c) => {
  const raw = await c.req.text()
  const creds = await webhookCredentials(db)
  if (!creds) return c.json({ error: 'Webhooks not configured' }, 503)
  if (!verifySquareSignature(raw, c.req.header('x-square-hmacsha256-signature'), creds.key, creds.url)) return c.json({ error: 'Bad signature' }, 401)
  let event: any
  try { event = JSON.parse(raw) } catch { return c.json({ error: 'Bad JSON' }, 400) }
  try {
    const what = await handleSquareEvent(db, event)
    return c.json({ ok: true, handled: what })
  } catch (e: any) {
    // 500 makes Square retry, which is what we want for a transient DB error.
    console.error('[square] webhook handling failed:', e?.message || e)
    return c.json({ error: 'Handler failed' }, 500)
  }
})
