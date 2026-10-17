// crm-store — a refund returns the money. (Owner's decision, 10/12)
//
// "Mark refunded" only changed the order's status: the order read refunded and the shopper's money stayed taken. As
// Shopify does it, refunding — or cancelling — a paid order now sends the payment back through Stripe, and only then
// restocks. Asserted through the real status route, the real permissions module and the real Stripe adapter; Stripe's
// HTTP API is answered here (the adapter runs over fetch), so each call it makes is seen exactly as Stripe would.
process.env.PAYMENT_ENC_KEY ||= 'refunds-test-key'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { storeSettings, users, orders, orderItems, orderRefunds, products, productVariants, paymentConfig } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()
const { encryptJSON } = await import('./src/lib/crypto.ts')
await db.insert(storeSettings).values({ companyName: 'Refund Store', currency: 'usd' } as any)
const { encrypt } = await import('./src/lib/crypto.ts')
await db.insert(paymentConfig).values({ provider: 'stripe', mode: 'test', connected: true, credentialsEnc: encryptJSON({ secretKey: 'sk_test_refunds' }), webhookSecretEnc: encrypt('whsec_refunds') } as any)
const mk = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@refund.test`, passwordHash: 'x', name, role } as any).returning())[0]
const owner = await mk('owner', 'owner'), managerA = await mk('manager', 'manager-a'), managerB = await mk('manager', 'manager-b'), staff = await mk('staff', 'staff')
const [product] = await db.insert(products).values({ slug: 'mug', name: 'Mug', status: 'active' } as any).returning()
const [variant] = await db.insert(productVariants).values({ productId: product.id, sku: 'MUG-1', name: 'Default', priceCents: 2500, inventoryQty: 10 } as any).returning()
const stock = async () => (await db.select().from(productVariants).where(eq(productVariants.id, variant.id)))[0].inventoryQty
const setStock = (n: number) => db.update(productVariants).set({ inventoryQty: n }).where(eq(productVariants.id, variant.id))
let n = 0
const mkOrder = async (status: string, extra: Record<string, unknown> = {}) => {
  n++
  const [o] = await db.insert(orders).values({
    orderNumber: `ORD-R${n}`, provider: 'stripe', providerSessionId: `cs_test_${n}`, providerPaymentId: `pi_test_${n}`, status,
    customerEmail: `shopper${n}@example.com`, subtotalCents: 5000, shippingCents: 0, taxCents: 0, totalCents: 5000, currency: 'usd', ...extra,
  } as any).returning()
  await db.insert(orderItems).values({ orderId: o.id, variantId: variant.id, productName: 'Mug', variantName: 'Default', sku: 'MUG-1', unitPriceCents: 2500, quantity: 2, lineTotalCents: 5000 } as any)
  return o
}
const orderNow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]

// ── Stripe, answered here ───────────────────────────────────────────────────────────────────────────
type Call = { paymentIntent: string | null; key: string | null; auth: string | null; amount: string | null }
const calls: Call[] = []
const refundsByKey = new Map<string, string>()
let mode: 'ok' | 'card_declined' | 'already' | 'pending' = 'ok'
let endpointEvents: string[] = ['checkout.session.completed']
const endpointUpdates: string[] = []
let endpointCreates = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith('https://api.stripe.com/')) return realFetch(input, init)
  const headers = new Headers(init?.headers || {})
  const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } })
  if (url.endsWith('/v1/refunds') && (init?.method || 'GET').toUpperCase() === 'POST') {
    const key = headers.get('idempotency-key')
    calls.push({ paymentIntent: body.get('payment_intent'), key, auth: headers.get('authorization'), amount: body.get('amount') })
    await new Promise((r) => setTimeout(r, 30))   // Stripe takes a moment — long enough for a second press to overlap
    if (mode === 'card_declined') return json({ error: { type: 'invalid_request_error', code: 'charge_disputed', message: 'This charge has been disputed and cannot be refunded.' } }, 400)
    if (mode === 'already') return json({ error: { type: 'invalid_request_error', code: 'charge_already_refunded', message: 'Charge ch_x has already been refunded.' } }, 400)
    // Idempotency, as Stripe keeps it: the same key returns the same refund.
    const id = (key && refundsByKey.get(key)) || `re_test_${refundsByKey.size + 1}`
    if (key) refundsByKey.set(key, id)
    return json({ id, object: 'refund', amount: Number(body.get('amount')) || 5000, currency: 'usd', status: mode === 'pending' ? 'pending' : 'succeeded', payment_intent: body.get('payment_intent') })
  }
  const method = (init?.method || 'GET').toUpperCase()
  if (/\/v1\/webhook_endpoints(\?|$)/.test(url) && method === 'GET') return json({ object: 'list', data: [{ id: 'we_1', object: 'webhook_endpoint', url: 'https://shop-api.test/api/public/webhooks/payment', enabled_events: endpointEvents }], has_more: false })
  if (/\/v1\/webhook_endpoints\/we_1$/.test(url) && method === 'POST') { endpointUpdates.push(decodeURIComponent(String(init?.body || ''))); return json({ id: 'we_1', object: 'webhook_endpoint', enabled_events: [] }) }
  if (/\/v1\/webhook_endpoints$/.test(url) && method === 'POST') { endpointCreates++; return json({ id: 'we_2' }) }
  return json({ error: { message: 'not answered here' } }, 404)
}) as any

const app = new Hono()
app.route('/api/admin/orders', (await import('./src/routes/orders.ts')).default)
const as = (who: any) => async (status: string, id: string) => {
  const res = await app.request(`/api/admin/orders/${id}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: JSON.stringify({ status }) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner), MA = as(managerA), MB = as(managerB), S = as(staff)

// 1. A refund sends the money back, then restocks.
{
  await setStock(10); const o = await mkOrder('paid'); const c0 = calls.length
  const r = await MA('refunded', o.id)
  const now = await orderNow(o.id)
  check(`refund: the manager's refund is sent to Stripe for the order's payment (${r.status})`, r.status === 200 && calls.length === c0 + 1 && calls[c0].paymentIntent === 'pi_test_1' && calls[c0].auth === 'Bearer sk_test_refunds', calls.slice(c0))
  check('refund: …with one idempotency key per order, so a repeat can never refund twice', calls[c0].key === `order-refund-${o.id}`, calls[c0])
  check(`refund: the order is refunded and the 2 units are back (10 → ${await stock()})`, now.status === 'refunded' && (await stock()) === 12)
  check('refund: the reply says the money went back, with Stripe\'s refund id', r.json?.refund?.kind === 'refunded' && r.json.refund.refundId === 're_test_1' && r.json.refund.status === 'succeeded' && r.json.refund.amountCents === 5000, r.json?.refund)
}
// 2. Cancelling a paid order refunds it too.
{
  await setStock(10); const o = await mkOrder('paid'); const c0 = calls.length
  const r = await O('cancelled', o.id)
  check(`cancel: cancelling a paid order refunds it at Stripe and restocks (${r.status}, stock ${await stock()})`, r.status === 200 && calls.length === c0 + 1 && (await orderNow(o.id)).status === 'cancelled' && (await stock()) === 12 && r.json?.refund?.kind === 'refunded', r.json)
}
// 3. Stripe refuses: the order is put back exactly as it was, nothing restocked.
{
  await setStock(10); const o = await mkOrder('shipped', { fulfilledAt: new Date('2026-10-01T10:00:00Z') })
  mode = 'card_declined'
  const r = await MA('refunded', o.id)
  mode = 'ok'
  const now = await orderNow(o.id)
  check(`refused: Stripe's refusal is a 502 refund_failed naming Stripe's reason (${r.status})`, r.status === 502 && r.json?.code === 'refund_failed' && /Stripe said: This charge has been disputed/.test(r.json?.error) && /still shipped and nothing was restocked/.test(r.json?.error), r.json)
  check('refused: …the order is still shipped, its fulfilment date untouched, stock untouched', now.status === 'shipped' && +new Date(now.fulfilledAt!) === +new Date('2026-10-01T10:00:00Z') && (await stock()) === 10, { status: now.status, fulfilledAt: now.fulfilledAt })
  const again = await MA('refunded', o.id)
  check('refused: …and pressing Refund again, once Stripe accepts, goes through', again.status === 200 && (await orderNow(o.id)).status === 'refunded' && (await stock()) === 12, again.json)
}
// 4. Two managers press Refund at once: one refund at Stripe, one restock.
{
  await setStock(10); const o = await mkOrder('paid'); const c0 = calls.length; const keysBefore = refundsByKey.size
  const rs = await Promise.all([MA('refunded', o.id), MB('refunded', o.id)])
  const codes = rs.map((r) => r.status).sort().join(',')
  check(`twice at once: one refund goes through, the other is told someone got there first (${codes})`, codes === '200,409' && rs.some((r) => r.json?.code === 'order_changed'), rs.map((r) => r.json))
  check(`twice at once: Stripe was asked once and made one refund (${calls.length - c0} call(s), ${refundsByKey.size - keysBefore} refund)`, calls.length - c0 === 1 && refundsByKey.size - keysBefore === 1)
  check(`twice at once: the units went back once (10 → ${await stock()})`, (await stock()) === 12)
}
// 5. A refund racing "mark shipped": whoever moves the order first wins; money goes back only if the refund won.
{
  await setStock(10); const o = await mkOrder('paid'); const c0 = calls.length
  const rs = await Promise.all([MA('refunded', o.id), S('shipped', o.id)])
  const now = await orderNow(o.id)
  const refundWon = rs[0].status === 200
  check(`refund vs ship: exactly one applies (${rs.map((r) => r.status).join(',')}, order ${now.status})`, rs.map((r) => r.status).sort().join(',') === '200,409')
  check('refund vs ship: Stripe is asked only if the refund won — never for an order that shipped', refundWon ? (calls.length === c0 + 1 && now.status === 'refunded') : (calls.length === c0 && now.status === 'shipped'), { refundWon, calls: calls.length - c0 })
}
// 6. Already refunded in Stripe's own dashboard: recorded here, no error, said so.
{
  await setStock(10); const o = await mkOrder('paid')
  mode = 'already'
  const r = await MA('refunded', o.id)
  mode = 'ok'
  check('already refunded at Stripe: the order is marked refunded and restocked, and the reply says it had been refunded already', r.status === 200 && (await orderNow(o.id)).status === 'refunded' && (await stock()) === 12 && r.json?.refund?.kind === 'refunded' && r.json.refund.alreadyRefunded === true, r.json)
}
// 7. A card refund Stripe is still settling counts as sent.
{
  const o = await mkOrder('paid'); mode = 'pending'
  const r = await MA('refunded', o.id); mode = 'ok'
  check('pending at Stripe: accepted as sent, status passed through', r.status === 200 && r.json?.refund?.status === 'pending')
}
// 8. No card payment on record (an order marked paid by hand): recorded, nothing sent, said so.
{
  await setStock(10); const o = await mkOrder('paid', { providerPaymentId: null }); const c0 = calls.length
  const r = await MA('refunded', o.id)
  check('no card payment: recorded refunded, restocked, Stripe not asked, and told to return it the way it was paid', r.status === 200 && calls.length === c0 && (await stock()) === 12 && r.json?.refund?.kind === 'none_on_file' && /Return it the way it was paid/.test(r.json.refund.note), r.json)
}
// 9. Paid through a provider that is not the one connected now (PayPal, while Stripe is): recorded, told where to refund.
//    (PayPal's own refund, with PayPal connected, is tests/store/paypal-refunds.test.ts.)
{
  const o = await mkOrder('paid', { provider: 'paypal', providerPaymentId: 'CAP-1' }); const c0 = calls.length
  const r = await MA('refunded', o.id)
  check('paid through PayPal: recorded only, Stripe not asked, told to refund in the PayPal dashboard', r.status === 200 && calls.length === c0 && r.json?.refund?.kind === 'manual' && /Refund it in your PayPal dashboard/.test(r.json.refund.note), r.json)
}
// 10. An unpaid order cancels with no money involved; staff still cannot refund.
{
  const o = await mkOrder('pending'); const c0 = calls.length
  const r = await MA('cancelled', o.id)
  check('pending: cancelling an unpaid order asks Stripe nothing and reports no refund', r.status === 200 && calls.length === c0 && r.json?.refund === undefined)
  const p = await mkOrder('paid'); const c1 = calls.length
  const s = await S('refunded', p.id)
  check('staff: a refund is refused before anything reaches Stripe', s.status === 403 && calls.length === c1 && (await orderNow(p.id)).status === 'paid')
}
// 11b. The payment's own ids go to who refunds (orders:refund), not to staff — the fleet took every Stripe id off the
// seats that do not need them (T43); the store's orders still carried the session, payment and refund ids. (10/12)
{
  const o = await mkOrder('paid', { refundId: 're_test_keep' })
  const read = async (who: any) => { const r = await app.request(`/api/admin/orders/${o.id}`, { headers: { 'x-test-user': who.id } }); return ((await r.json()) as any).order }
  const s = await read(staff), m = await read(managerA)
  check('ids: staff are sent no checkout session, payment or refund id', !('providerSessionId' in s) && !('providerPaymentId' in s) && !('refundId' in s) && s.orderNumber === o.orderNumber, Object.keys(s).filter((k) => /provider|refund/i.test(k)))
  check('ids: the manager, who refunds, still is', m.providerPaymentId === o.providerPaymentId && m.refundId === 're_test_keep')
  const list = await (await app.request('/api/admin/orders', { headers: { 'x-test-user': staff.id } })).json() as any
  check('ids: …nor in the order list', !JSON.stringify(list.orders).includes('pi_test_') && !JSON.stringify(list.orders).includes('cs_test_'))
}
// 12. A refund interrupted between the order moving and Stripe answering is finished — once.
const { resumePendingRefunds } = await import('./src/routes/orders.ts')
const { auditLog } = await import('./db/schema.ts')
{
  await setStock(10)
  const o = await mkOrder('refunded', { refundPendingAt: new Date(Date.now() - 10 * 60_000) })
  const c0 = calls.length
  const found = await resumePendingRefunds()
  const now = await orderNow(o.id)
  check(`interrupted: the stuck refund is finished — asked of Stripe with the order's own key (${found} found)`, found >= 1 && calls.length === c0 + 1 && calls[c0].key === `order-refund-${o.id}`)
  check(`interrupted: stamp off, Stripe's refund id kept, the units back (10 → ${await stock()})`, !now.refundPendingAt && /^re_test_/.test(now.refundId || '') && !!now.refundedAt && (await stock()) === 12, now)
  const row = (await db.select().from(auditLog)).find((r: any) => r.entityId === o.id)
  check(`interrupted: the log says so ("${(row?.metadata as any)?.description}")`, /^Refund completed after an interruption — \$50\.00 sent back to the card, 2 units back in stock$/.test((row?.metadata as any)?.description || ''))
  const again = await resumePendingRefunds()
  // Two finishers at once — the request and the sweep — on one order: the stamp comes off once, the stock goes back once.
  const { settleRefund } = await import('./src/routes/orders.ts')
  await setStock(10)
  const twice = await mkOrder('refunded', { refundPendingAt: new Date() })
  const settled = await Promise.all([settleRefund(twice.id, { kind: 'none_on_file', note: '' }), settleRefund(twice.id, { kind: 'none_on_file', note: '' })])
  check(`interrupted: two finishers on one order restock it once (${settled.join(' + ')} units; stock ${await stock()})`, settled.sort().join(',') === '0,2' && (await stock()) === 12)
  await setStock(12)
  check('interrupted: running it again finds nothing, asks Stripe nothing, restocks nothing', again === 0 && calls.length === c0 + 1 && (await stock()) === 12)
  const fresh = await mkOrder('refunded', { refundPendingAt: new Date(Date.now() - 20_000) })
  await resumePendingRefunds()
  check('interrupted: a refund only seconds old is left to the request still finishing it', !!(await orderNow(fresh.id)).refundPendingAt)
  await db.update(orders).set({ refundPendingAt: null }).where(eq(orders.id, fresh.id))
}
// 13. Stripe refuses a refund being finished: kept on the order, nothing restocked, Try again works, staff cannot.
{
  await setStock(10)
  const o = await mkOrder('refunded', { refundPendingAt: new Date(Date.now() - 10 * 60_000) })
  mode = 'card_declined'; await resumePendingRefunds(); mode = 'ok'
  const held = await orderNow(o.id)
  check('refused while finishing: the reason is kept on the order, the stamp stays, nothing restocked', !!held.refundPendingAt && /Stripe said: This charge has been disputed/.test(held.refundError || '') && (await stock()) === 10, held)
  const retry = (who: any) => app.request(`/api/admin/orders/${o.id}/refund/retry`, { method: 'POST', headers: { 'x-test-user': who.id } })
  check('refused while finishing: staff cannot press Try again', (await retry(staff)).status === 403)
  const r = await retry(managerA); const j: any = await r.json()
  const done = await orderNow(o.id)
  check(`refused while finishing: the manager's Try again sends it and restocks (${r.status}, stock ${await stock()})`, r.status === 200 && j.refund?.kind === 'refunded' && !done.refundPendingAt && !done.refundError && (await stock()) === 12, j)
}
// 14. Refunds made in Stripe's own dashboard reach the order (charge.refunded, signed).
{
  const Stripe = (await import('stripe')).default
  const stripe = new Stripe('sk_test_x')
  const pub = new Hono(); pub.route('/api/public', (await import('./src/routes/public.ts')).default)
  const event = (pi: string, refunded: number, amount = 5000) => JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type: 'charge.refunded', data: { object: { id: 'ch_x', object: 'charge', payment_intent: pi, amount, amount_refunded: refunded, currency: 'usd' } } })
  const post = async (payload: string, secret = 'whsec_refunds') => {
    const sig = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret })
    return pub.request('/api/public/webhooks/payment', { method: 'POST', headers: { 'stripe-signature': sig, 'content-type': 'application/json' }, body: payload })
  }
  await setStock(10)
  const o = await mkOrder('shipped', { fulfilledAt: new Date() }); const c0 = calls.length
  const r = await post(event(o.providerPaymentId!, 5000))
  const now = await orderNow(o.id)
  check(`dashboard refund: a full refund made in Stripe marks the order refunded and restocks (${r.status}, stock ${await stock()})`, r.status === 200 && now.status === 'refunded' && !now.refundPendingAt && (await stock()) === 12 && calls.length === c0)
  const row = (await db.select().from(auditLog)).find((x: any) => x.entityId === o.id)
  check(`dashboard refund: logged as Stripe's, by no one here ("${(row?.metadata as any)?.description}")`, (row?.metadata as any)?.description === "Refunded in Stripe's dashboard — $50.00, 2 units back in stock" && !row?.userId)
  await post(event(o.providerPaymentId!, 5000))
  check('dashboard refund: the same notice again changes nothing', (await stock()) === 12 && (await db.select().from(auditLog)).filter((x: any) => x.entityId === o.id).length === 1)
  await setStock(10); const own = await mkOrder('paid'); await MA('refunded', own.id)
  await post(event(own.providerPaymentId!, 5000))
  check('dashboard refund: the echo of a refund made HERE is recognised — no second restock', (await stock()) === 12 && (await orderNow(own.id)).status === 'refunded')
  const settling = await mkOrder('refunded', { refundPendingAt: new Date() }); await setStock(10)
  await post(event(settling.providerPaymentId!, 5000))
  check('dashboard refund: a refund still settling here is left to settle', (await stock()) === 10 && !!(await orderNow(settling.id)).refundPendingAt)
  await db.update(orders).set({ refundPendingAt: null }).where(eq(orders.id, settling.id))
  const part = await mkOrder('paid'); await setStock(10)
  await post(event(part.providerPaymentId!, 1500))
  const prow = (await db.select().from(auditLog)).find((x: any) => x.entityId === part.id)
  // A part refund made in Stripe's dashboard is the order's money going back too: it is on the order's refund history and
  // in refundedCents (so the dashboard counts it), with no units restocked — Stripe cannot say which ones it was for.
  const prefunds = await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, part.id))
  check(`dashboard refund: a part refund is recorded — the order still paid, nothing restocked ("${(prow?.metadata as any)?.description}")`, (await orderNow(part.id)).status === 'paid' && (await orderNow(part.id)).refundedCents === 1500 && (await stock()) === 10 && prefunds.length === 1 && prefunds[0].amountCents === 1500 && prefunds[0].moneyBack === 'provider_dashboard' && prefunds[0].items.length === 0 && (prow?.metadata as any)?.description === "Partly refunded in Stripe's dashboard: $15.00 ($15.00 of $50.00 back so far) — no units restocked", prefunds)
  await post(event(part.providerPaymentId!, 1500))
  check('dashboard refund: the same part-refund notice again records nothing more', (await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, part.id))).length === 1 && (await orderNow(part.id)).refundedCents === 1500)
  const forged = await post(event(part.providerPaymentId!, 5000), 'whsec_wrong')
  check("dashboard refund: a notice not signed with the store's secret is refused", forged.status === 400 && (await orderNow(part.id)).status === 'paid')
}
// 15. A store connected before refunds were listened for has its Stripe webhook brought up to date — updated, not re-created.
{
  process.env.BACKEND_URL = 'https://shop-api.test'
  const { ensureStripeWebhookEvents, STRIPE_WEBHOOK_EVENTS } = await import('./src/routes/payments.ts')
  endpointEvents = ['checkout.session.completed']
  const u0 = endpointUpdates.length
  const first = await ensureStripeWebhookEvents()
  check(`webhook: the endpoint is updated to listen for refunds too (${first})`, first === 'updated' && endpointUpdates.length === u0 + 1 && endpointUpdates[u0].includes('charge.refunded') && endpointUpdates[u0].includes('checkout.session.completed') && endpointCreates === 0, endpointUpdates.slice(u0))
  endpointEvents = [...STRIPE_WEBHOOK_EVENTS]
  const second = await ensureStripeWebhookEvents()
  check(`webhook: …and left alone once it does (${second})`, second === 'current' && endpointUpdates.length === u0 + 1)
}
// 11. The screen asks, with the amount, and names the buttons for what they do.
{
  const src = (require('node:fs') as typeof import('node:fs')).readFileSync((process.env.FACTORY_ROOT || '').replace(/\/?$/, '/') + 'templates/crm-store/frontend/src/pages/OrderDetailPage.tsx', 'utf8').replace(/\r\n/g, '\n')
  check('screen: Refund and "Cancel and refund" are named for what they do on a paid order', /COUNTED\.includes\(from\) && to === 'refunded' \? \(partlyRefunded \? 'Refund the rest' : 'Refund everything'\) : COUNTED\.includes\(from\) && to === 'cancelled' \? 'Cancel and refund'/.test(src))
  check('screen: it asks first, with the amount, before money moves', /if \(!confirm\(ask\)\) return/.test(src) && /to the customer's card\? The stock goes back on the shelf\./.test(src))
  check('screen: it says what happened to the money, and reloads after a refused refund', /Cancelled and refunded/.test(src) && /refund\.note/.test(src) && /e\?\.code === 'refund_failed'\) load\(\)/.test(src))
}
// 12. A part refund through Stripe sends that amount — not the whole charge — under its own key; the rest sends the rest.
{
  await setStock(10); const o = await mkOrder('paid'); const c0 = calls.length
  const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id))
  const res = await app.request(`/api/admin/orders/${o.id}/refunds`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': managerA.id }, body: JSON.stringify({ items: [{ orderItemId: line.id, quantity: 1 }], restock: true }) })
  const j: any = await res.json()
  const [row] = await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, o.id))
  check(`part (Stripe): one Mug of two is $25.00 back, sent as amount=2500 under refund-<id> (${res.status})`, res.status === 200 && calls.length === c0 + 1 && calls[c0].amount === '2500' && calls[c0].key === `refund-${row?.id}` && row?.status === 'refunded' && row?.providerRefundId === j.refund?.refundId, { status: res.status, call: calls[c0], row })
  check('part (Stripe): …the order is still paid, with $25.00 back and one unit restocked', j.order?.status === 'paid' && j.order?.refundedCents === 2500 && (await stock()) === 11)
  const rest = await MA('refunded', o.id)
  check('part (Stripe): Refund the rest sends the other $25.00 and restocks only the other unit', rest.status === 200 && calls.length === c0 + 2 && calls[c0 + 1].amount === '2500' && calls[c0 + 1].key === `order-refund-${o.id}-2500` && (await stock()) === 12 && (await orderNow(o.id)).refundedCents === 5000, { call: calls[c0 + 1], stock: await stock() })
}

globalThis.fetch = realFetch
console.log(`\nrefunds through stripe: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
