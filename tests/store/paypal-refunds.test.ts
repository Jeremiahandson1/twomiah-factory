// crm-store — a refund on a PayPal order returns the money through PayPal.
//
// Before this, PayPalProvider had no refund: a refund on a PayPal-paid order was only RECORDED and the owner was told to
// refund it in PayPal's dashboard. Now it goes to PayPal's Payments v2 API — POST /v2/payments/captures/{capture_id}/refund,
// PayPal-Request-Id as the idempotency key — through the store's one refund flow (reserve → provider → settle).
//
// Asserted through the real orders routes, the real permissions module and the real PayPal adapter. PayPal's HTTP API is
// answered here by a stand-in written to PayPal's documented behaviour (the same PayPal-Request-Id answers the same refund;
// no amount refunds what is left of the capture; more than is left is a 422 REFUND_AMOUNT_EXCEEDED; nothing left is a 422
// CAPTURE_FULLY_REFUNDED). Nothing leaves the machine — this is NOT a PayPal sandbox call.
process.env.PAYMENT_ENC_KEY ||= 'paypal-refunds-test-key'
process.env.RESEND_API_KEY = 'test-resend'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { storeSettings, users, orders, orderItems, orderRefunds, products, productVariants, paymentConfig } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

await setupSchema()
const { encryptJSON, encrypt } = await import('./src/lib/crypto.ts')
await db.insert(storeSettings).values({ companyName: 'Pal Shop', currency: 'usd', supportEmail: 'owner@pal.test' } as any)
await db.insert(paymentConfig).values({ provider: 'paypal', mode: 'test', connected: true, credentialsEnc: encryptJSON({ secretKey: 'pp-secret', publishableKey: 'pp-client' }), webhookSecretEnc: encrypt('WH-TEST') } as any)
const mk = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@pal.test`, passwordHash: 'x', name, role } as any).returning())[0]
const managerA = await mk('manager', 'manager-a'), managerB = await mk('manager', 'manager-b')
const [product] = await db.insert(products).values({ slug: 'mug', name: 'Mug', status: 'active' } as any).returning()
const [mugV] = await db.insert(productVariants).values({ productId: product.id, sku: 'MUG-1', name: 'Default', priceCents: 1500, inventoryQty: 10 } as any).returning()
const [shirtV] = await db.insert(productVariants).values({ productId: product.id, sku: 'SHIRT-L', name: 'Large', priceCents: 2200, inventoryQty: 10 } as any).returning()
const stock = async (v = mugV.id) => (await db.select().from(productVariants).where(eq(productVariants.id, v)))[0].inventoryQty
const setStock = async (n = 10) => { await db.update(productVariants).set({ inventoryQty: n }).where(eq(productVariants.id, mugV.id)); await db.update(productVariants).set({ inventoryQty: n }).where(eq(productVariants.id, shirtV.id)) }

// 2 Mugs at $15 + 1 Shirt at $22 = $52.00, 10% off (−$5.20), shipping $5.00, tax $3.39 → $55.19. (One Mug's share: $14.48.)
let n = 0
const mkOrder = async (extra: Record<string, unknown> = {}) => {
  n++
  const [o] = await db.insert(orders).values({
    orderNumber: `ORD-PP${n}`, provider: 'paypal', providerSessionId: `PP-ORDER-${n}`, providerPaymentId: `PP-CAP-${n}`, status: 'paid',
    customerEmail: `shopper${n}@example.com`, customerName: 'Pat Shopper',
    subtotalCents: 5200, discountCents: 520, discountCode: 'TEN', shippingCents: 500, taxCents: 339, totalCents: 5519, currency: 'usd', ...extra,
  } as any).returning()
  const [mug] = await db.insert(orderItems).values({ orderId: o.id, variantId: mugV.id, productName: 'Mug', variantName: 'Default', sku: 'MUG-1', unitPriceCents: 1500, quantity: 2, lineTotalCents: 3000 } as any).returning()
  const [shirt] = await db.insert(orderItems).values({ orderId: o.id, variantId: shirtV.id, productName: 'Shirt', variantName: 'Large', sku: 'SHIRT-L', unitPriceCents: 2200, quantity: 1, lineTotalCents: 2200 } as any).returning()
  return { o, mug, shirt }
}
const orderNow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]
const rowsOf = async (id: string) => db.select().from(orderRefunds).where(eq(orderRefunds.orderId, id))
const itemNow = async (id: string) => (await db.select().from(orderItems).where(eq(orderItems.id, id)))[0]

// ── PayPal, answered here ──────────────────────────────────────────────────────────────────────────
// Each capture is $55.19. refundedOn = what PayPal has sent back off a capture. byRequestId = PayPal's idempotency memory.
const CAPTURE_CENTS = 5519
type PpCall = { capture: string; requestId: string | null; body: any; auth: string | null; prefer: string | null }
const pp: PpCall[] = []
const byRequestId = new Map<string, { id: string; cents: number; status: string; capture: string }>()
const refundedOn = new Map<string, number>()
let tokens = 0, refundSeq = 0
let mode: 'completed' | 'pending' | 'error500' | 'drop' | 'refuse' | 'failed' | 'badauth' = 'completed'
const mails: any[] = []
const lookups: string[] = []
let lookupMode: 'ok' | 'drop' = 'ok'
const verifies: any[] = []
let hookEvents: string[] = ['PAYMENT.CAPTURE.COMPLETED']
const hookPatches: any[] = []
const toCents = (v: string) => { const [a, b = ''] = v.split('.'); return Number(a) * 100 + Number(b.padEnd(2, '0')) }
const fmt = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (url === 'https://api.resend.com/emails') { mails.push(JSON.parse(init.body)); return json({ id: 'm' }) }
  if (!url.startsWith('https://api-m.sandbox.paypal.com/')) return realFetch(input, init)
  const headers = new Headers(init?.headers || {})
  const method = (init?.method || 'GET').toUpperCase()
  if (url.endsWith('/v1/oauth2/token') && method === 'POST') {
    tokens++
    if (mode === 'badauth' || headers.get('authorization') !== 'Basic ' + Buffer.from('pp-client:pp-secret').toString('base64')) return json({ error: 'invalid_client', error_description: 'Client Authentication failed' }, 401)
    return json({ access_token: 'A21-test-token', token_type: 'Bearer', expires_in: 32400 })
  }
  const m = url.match(/\/v2\/payments\/captures\/([^/]+)\/refund$/)
  if (m && method === 'POST') {
    const capture = decodeURIComponent(m[1])
    const body = init?.body ? JSON.parse(init.body) : {}
    const requestId = headers.get('paypal-request-id')
    pp.push({ capture, requestId, body, auth: headers.get('authorization'), prefer: headers.get('prefer') })
    await new Promise((r) => setTimeout(r, 15))
    if (headers.get('authorization') !== 'Bearer A21-test-token') return json({ name: 'AUTHENTICATION_FAILURE', message: 'Authentication failed' }, 401)
    if (mode === 'drop') throw new TypeError('fetch failed')
    if (mode === 'refuse') return json({ name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', details: [{ issue: 'REFUND_NOT_ALLOWED', description: 'Refund cannot be issued for this capture.' }] }, 422)
    // Idempotency: the same PayPal-Request-Id answers the SAME refund and sends nothing more.
    const seen = requestId ? byRequestId.get(requestId) : undefined
    if (seen) return json({ id: seen.id, status: seen.status, amount: { value: fmt(seen.cents), currency_code: 'USD' } }, 200)
    const left = CAPTURE_CENTS - (refundedOn.get(capture) || 0)
    if (left <= 0) return json({ name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', details: [{ issue: 'CAPTURE_FULLY_REFUNDED', description: 'The capture has already been fully refunded' }] }, 422)
    if (body.amount && !/^\d+\.\d{2}$/.test(body.amount.value)) return json({ name: 'INVALID_REQUEST', details: [{ issue: 'DECIMAL_PRECISION', description: 'bad amount ' + body.amount.value }] }, 400)
    const want = body.amount ? toCents(body.amount.value) : left
    if (want > left) return json({ name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', details: [{ issue: 'REFUND_AMOUNT_EXCEEDED', description: 'The refund amount must be less than or equal to the capture amount that has not yet been refunded.' }] }, 422)
    if (mode === 'failed') {
      const r = { id: `PP-REF-${++refundSeq}`, cents: want, status: 'FAILED', capture }
      if (requestId) byRequestId.set(requestId, r)
      return json({ id: r.id, status: 'FAILED', status_details: { reason: 'ECHECK' }, amount: { value: fmt(want), currency_code: 'USD' } }, 201)
    }
    const r = { id: `PP-REF-${++refundSeq}`, cents: want, status: mode === 'pending' ? 'PENDING' : 'COMPLETED', capture }
    if (requestId) byRequestId.set(requestId, r)
    refundedOn.set(capture, (refundedOn.get(capture) || 0) + want)
    // The refund WENT THROUGH at PayPal, but the answer never made it back.
    if (mode === 'error500') return json({ name: 'INTERNAL_SERVER_ERROR', message: 'An internal server error occurred.' }, 500)
    return json({ id: r.id, status: r.status, amount: { value: fmt(want), currency_code: 'USD' } }, 201)
  }
  // GET a refund by id — where a held refund stands now.
  const rg = url.match(/\/v2\/payments\/refunds\/([^/?]+)$/)
  if (rg && method === 'GET') {
    lookups.push(decodeURIComponent(rg[1]))
    if (lookupMode === 'drop') throw new TypeError('fetch failed')
    const found = [...byRequestId.values()].find((x) => x.id === decodeURIComponent(rg[1]))
    if (!found) return json({ name: 'RESOURCE_NOT_FOUND' }, 404)
    return json({ id: found.id, status: found.status, amount: { value: fmt(found.cents), currency_code: 'USD' } })
  }
  // GET a capture — its amount, and REFUNDED once nothing is left.
  const cg = url.match(/\/v2\/payments\/captures\/([^/?]+)$/)
  if (cg && method === 'GET') {
    const id = decodeURIComponent(cg[1]); const back = refundedOn.get(id) || 0
    return json({ id, status: back >= CAPTURE_CENTS ? 'REFUNDED' : back > 0 ? 'PARTIALLY_REFUNDED' : 'COMPLETED', amount: { value: fmt(CAPTURE_CENTS), currency_code: 'USD' } })
  }
  // Webhook signature check: PayPal vouches only for a transmission it signed (here: paypal-transmission-sig good-sig).
  if (url.endsWith('/v1/notifications/verify-webhook-signature') && method === 'POST') {
    const b = JSON.parse(init.body)
    verifies.push(b)
    return json({ verification_status: b.transmission_sig === 'good-sig' && b.webhook_id === 'WH-TEST' ? 'SUCCESS' : 'FAILURE' })
  }
  // The store's webhook on PayPal: read, and its event types replaced.
  if (url.endsWith('/v1/notifications/webhooks/WH-TEST') && method === 'GET') return json({ id: 'WH-TEST', url: 'https://shop-api.test/api/public/webhooks/payment', event_types: hookEvents.map((name) => ({ name })) })
  if (url.endsWith('/v1/notifications/webhooks/WH-TEST') && method === 'PATCH') { hookPatches.push(JSON.parse(init.body)); return json({ id: 'WH-TEST' }) }
  return json({ name: 'RESOURCE_NOT_FOUND' }, 404)
}) as any

const ordersModule = await import('./src/routes/orders.ts')
const app = new Hono()
app.route('/api/admin/orders', ordersModule.default)
const call = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api/admin/orders${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const MA = call(managerA), MB = call(managerB)
const part = (id: string, body: unknown) => MA('POST', `/${id}/refunds`, body)
const settle = () => new Promise((r) => setTimeout(r, 50))

// 1. A part refund — one Mug — goes to PayPal: the capture, the amount as PayPal's decimal string, its own request id.
{
  await setStock(); const { o, mug } = await mkOrder(); const c0 = pp.length, m0 = mails.length
  const r = await part(o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true, reason: 'Arrived chipped' })
  const [row] = await rowsOf(o.id)
  const c = pp[c0]
  check(`part: PayPal is asked once, on the order's CAPTURE id (${r.status})`, r.status === 200 && pp.length === c0 + 1 && c?.capture === 'PP-CAP-' + n, { r: r.json, c })
  check(`part: …for "14.48" USD — a decimal string, not cents (${JSON.stringify(c?.body?.amount)})`, c?.body?.amount?.value === '14.48' && c.body.amount.currency_code === 'USD', c?.body)
  check(`part: …under PayPal-Request-Id refund-<row id> (${c?.requestId})`, c?.requestId === `refund-${row?.id}`, c)
  check('part: …with the OAuth bearer token from client credentials, and Prefer: return=representation', c?.auth === 'Bearer A21-test-token' && c?.prefer === 'return=representation')
  check('part: …and the owner\'s reason as the note to the buyer', c?.body?.note_to_payer === 'Arrived chipped')
  check(`part: the row reads refunded with PayPal's refund id (${row?.providerRefundId})`, row?.status === 'refunded' && row.providerRefundId === 'PP-REF-' + refundSeq && row.amountCents === 1448 && row.moneyBack === 'refunded', row)
  check('part: the order is still paid with $14.48 back, one Mug back on the shelf', (await orderNow(o.id)).status === 'paid' && (await orderNow(o.id)).refundedCents === 1448 && (await stock()) === 11)
  check('part: PayPal sent back exactly $14.48 off the capture', refundedOn.get('PP-CAP-' + n) === 1448)
  check('part: the reply says it went back through PayPal, completed', r.json?.refund?.kind === 'refunded' && r.json.refund.status === 'succeeded' && r.json.refund.amountCents === 1448, r.json?.refund)
  await settle()
  check('part: the shopper is emailed what came back', mails.slice(m0).some((x) => x.to === o.customerEmail && /\$14\.48 refunded/.test(x.subject)), mails.slice(m0).map((x) => x.subject))
}

// 2. Two part refunds: each its own request id, each its own amount; PayPal's total is their sum.
{
  await setStock(); const { o, mug, shirt } = await mkOrder(); const c0 = pp.length
  const a = await part(o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
  const b = await part(o.id, { items: [{ orderItemId: shirt.id, quantity: 1 }], restock: true })
  const calls = pp.slice(c0)
  check(`two parts: both go through (${a.status}, ${b.status})`, a.status === 200 && b.status === 200)
  check(`two parts: two PayPal calls, amounts "14.48" and "21.23", different request ids`, calls.length === 2 && calls[0].body.amount.value === '14.48' && calls[1].body.amount.value === '21.23' && calls[0].requestId !== calls[1].requestId, calls.map((x) => [x.requestId, x.body.amount]))
  check(`two parts: PayPal sent back $35.71 in all, the order says the same (${refundedOn.get('PP-CAP-' + n)})`, refundedOn.get('PP-CAP-' + n) === 3571 && (await orderNow(o.id)).refundedCents === 3571)
  // 2b. The rest after the parts: the amount named, under a key naming what had gone back.
  const rest = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  const last = pp.at(-1)!
  check(`the rest: "19.48" is sent (55.19 − 35.71), under order-refund-<id>-3571 (${last.body?.amount?.value}, ${last.requestId})`, rest.status === 200 && last.body?.amount?.value === '19.48' && last.requestId === `order-refund-${o.id}-3571`, last)
  check('the rest: the order is refunded in full, PayPal agrees, the last Mug back on the shelf', (await orderNow(o.id)).status === 'refunded' && (await orderNow(o.id)).refundedCents === 5519 && refundedOn.get('PP-CAP-' + n) === 5519 && (await stock()) === 12, await orderNow(o.id))
}

// 3. A whole refund with nothing refunded yet: no amount in the body — PayPal refunds what is left of the capture.
{
  await setStock(); const { o } = await mkOrder(); const c0 = pp.length
  const r = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  const c = pp[c0]
  check(`full: refunded through PayPal (${r.status}, ${r.json?.refund?.kind})`, r.status === 200 && r.json?.refund?.kind === 'refunded' && r.json.refund.status === 'succeeded', r.json)
  check(`full: one call, no amount (PayPal refunds the remainder), request id order-refund-<id> (${c?.requestId})`, pp.length === c0 + 1 && !('amount' in (c?.body || {})) && c?.requestId === `order-refund-${o.id}`, c)
  check('full: PayPal sent back the whole $55.19; the order is refunded and restocked', refundedOn.get('PP-CAP-' + n) === 5519 && (await orderNow(o.id)).status === 'refunded' && (await orderNow(o.id)).refundedCents === 5519 && (await stock()) === 12 && (await stock(shirtV.id)) === 11)
  check(`full: the amount PayPal reports back is read as cents (${r.json?.refund?.amountCents})`, r.json?.refund?.amountCents === 5519)
}

// 4. PayPal does the refund but answers 500: the part WAITS, and Try again sends the SAME request id — never twice.
{
  await setStock(); const { o, mug } = await mkOrder(); const c0 = pp.length, m0 = mails.length
  mode = 'error500'
  const r = await part(o.id, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true })
  mode = 'completed'
  const [row] = await rowsOf(o.id)
  check(`500: a 502 refund_unconfirmed, the row pending, the money and units reserved, nothing restocked (${r.status} ${r.json?.code})`, r.status === 502 && r.json?.code === 'refund_unconfirmed' && row?.status === 'pending' && (await orderNow(o.id)).refundedCents === 2896 && (await itemNow(mug.id)).refundedQuantity === 2 && (await stock()) === 10, { r: r.json, row })
  const retry = await MA('POST', `/${o.id}/refunds/${row.id}/retry`)
  check(`500: Try again asks PayPal under the SAME PayPal-Request-Id (${pp[c0]?.requestId} / ${pp[c0 + 1]?.requestId})`, retry.status === 200 && pp.length === c0 + 2 && pp[c0 + 1].requestId === pp[c0].requestId && pp[c0].requestId === `refund-${row.id}`, pp.slice(c0))
  check(`500: PayPal sent the money back ONCE — $28.96, not $57.92 (${refundedOn.get('PP-CAP-' + n)})`, refundedOn.get('PP-CAP-' + n) === 2896)
  const [after] = await rowsOf(o.id)
  check('500: it settles once — refunded, both Mugs back on the shelf', after.status === 'refunded' && (await stock()) === 12 && (await orderNow(o.id)).refundedCents === 2896, after)
  await settle()
  check('500: the shopper is emailed once', mails.slice(m0).filter((x) => x.to === o.customerEmail).length === 1)
}

// 4b. No answer at all on a whole refund (connection dropped): the order is not left reading refunded with the money
//     unknown — and asking again (same request id) finds the refund PayPal already made instead of making a second.
{
  await setStock(); const { o } = await mkOrder(); const c0 = pp.length
  mode = 'error500'
  const r = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  mode = 'completed'
  check(`whole, 500: answered 502, the order back as it was (${r.status}, ${(await orderNow(o.id)).status})`, r.status === 502 && (await orderNow(o.id)).status === 'paid' && (await stock()) === 10)
  const again = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  check(`whole, 500: refunding again re-sends the same request id and PayPal answers the same refund (${pp[c0]?.requestId})`, again.status === 200 && pp.length === c0 + 2 && pp[c0 + 1].requestId === pp[c0].requestId && refundedOn.get('PP-CAP-' + n) === 5519 && (await orderNow(o.id)).status === 'refunded', pp.slice(c0))
}

// 4c. Interrupted part (connection dropped): resumePendingRefunds finishes it under the same request id.
{
  await setStock(); const { o, shirt } = await mkOrder()
  mode = 'drop'; const r = await part(o.id, { items: [{ orderItemId: shirt.id, quantity: 1 }], restock: true }); mode = 'completed'
  const [row] = await rowsOf(o.id)
  check(`dropped: the part waits (${r.status} ${r.json?.code}); PayPal sent nothing`, r.status === 502 && r.json?.code === 'refund_unconfirmed' && row.status === 'pending' && !refundedOn.get('PP-CAP-' + n))
  await db.update(orderRefunds).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(orderRefunds.id, row.id))
  const c0 = pp.length
  await ordersModule.resumePendingRefunds()
  const [after] = await rowsOf(o.id)
  check('dropped: resumed under refund-<id>, settled once, the Shirt back', pp.length === c0 + 1 && pp[c0].requestId === `refund-${row.id}` && after.status === 'refunded' && refundedOn.get('PP-CAP-' + n) === 2123 && (await stock(shirtV.id)) === 11, { after, calls: pp.slice(c0) })
}

// 5. PayPal ANSWERS no — 422 REFUND_AMOUNT_EXCEEDED (more was refunded in PayPal's dashboard than the store knows of):
//    nothing sent, so the reservation goes back and the order is exactly as it was.
{
  await setStock(); const { o, mug } = await mkOrder()
  refundedOn.set('PP-CAP-' + n, 5000)
  const before = await orderNow(o.id)
  const r = await part(o.id, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true })
  const [row] = await rowsOf(o.id)
  check(`422: a 502 refund_failed in PayPal's words (${r.status} ${r.json?.code})`, r.status === 502 && r.json?.code === 'refund_failed' && /REFUND_AMOUNT_EXCEEDED/.test(r.json?.error) && /nothing was sent back/.test(r.json?.error), r.json)
  const now = await orderNow(o.id)
  check('422: the row reads failed; the order has nothing back, still paid, both Mugs still refundable, nothing restocked', row?.status === 'failed' && /REFUND_AMOUNT_EXCEEDED/.test(row.error || '') && now.refundedCents === 0 && now.status === 'paid' && now.refundedCents === before.refundedCents && (await itemNow(mug.id)).refundedQuantity === 0 && (await stock()) === 10, { row, now })
  check('422: PayPal\'s own total is untouched', refundedOn.get('PP-CAP-' + n) === 5000)
}
// 5b. A refusal on a whole refund: the order goes back to paid, nothing restocked.
{
  await setStock(); const { o } = await mkOrder()
  mode = 'refuse'
  const r = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  mode = 'completed'
  check(`422 whole: refund_failed, the order still paid, nothing restocked (${r.status})`, r.status === 502 && r.json?.code === 'refund_failed' && /REFUND_NOT_ALLOWED/.test(r.json?.error) && (await orderNow(o.id)).status === 'paid' && !(await orderNow(o.id)).refundPendingAt && (await stock()) === 10, r.json)
}
// 5c. PayPal accepts the request but the refund comes back FAILED: that is a no as well.
{
  await setStock(); const { o, mug } = await mkOrder()
  mode = 'failed'
  const r = await part(o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
  mode = 'completed'
  const [row] = await rowsOf(o.id)
  check(`FAILED: refused, reservation released (${r.status} ${r.json?.code})`, r.status === 502 && r.json?.code === 'refund_failed' && /did not complete the refund \(failed: ECHECK\)/.test(r.json?.error) && row.status === 'failed' && (await orderNow(o.id)).refundedCents === 0 && (await stock()) === 10, r.json)
}
// 5d. PayPal refuses the credentials (401 on the token): the refund was never asked for — refused, not "unknown".
{
  await setStock(); const { o, mug } = await mkOrder(); const c0 = pp.length
  mode = 'badauth'
  const r = await part(o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
  mode = 'completed'
  check(`bad credentials: refund_failed, no refund call made, nothing reserved (${r.status} ${r.json?.code})`, r.status === 502 && r.json?.code === 'refund_failed' && /PayPal auth failed/.test(r.json?.error) && pp.length === c0 && (await orderNow(o.id)).refundedCents === 0, r.json)
}

// 6. PENDING — an eCheck refund PayPal is HOLDING: the money has not gone back and may never. The store keeps it
//    reserved, restocks nothing, tells nobody, and asks after it by its own id — never by sending another refund.
const pal = (id: string) => [...byRequestId.values()].find((x) => x.id === id)!
// PayPal finishes a held refund: COMPLETED, or FAILED (the money never left, so its running total goes back down).
const paypalDecides = (id: string, status: 'COMPLETED' | 'FAILED') => { const r = pal(id); r.status = status; if (status === 'FAILED') refundedOn.set(r.capture, (refundedOn.get(r.capture) || 0) - r.cents) }
const backdate = (rowId: string) => db.update(orderRefunds).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(orderRefunds.id, rowId))
{
  await setStock(); const { o, mug } = await mkOrder(); const m0 = mails.length
  mode = 'pending'
  const a = await part(o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
  mode = 'completed'
  const [row] = await rowsOf(o.id)
  check(`held part: answered 200, the refund awaiting PayPal (${a.json?.refund?.status}, awaiting ${a.json?.refund?.awaiting})`, a.status === 200 && a.json?.refund?.kind === 'refunded' && a.json.refund.status === 'pending' && a.json.refund.awaiting === true && a.json.restocked === 0, a.json)
  check(`held part: the row stays pending with PayPal's refund id; $14.48 and one Mug stay reserved; nothing restocked`, row?.status === 'pending' && row.providerRefundId === 'PP-REF-' + refundSeq && !row.error && (await orderNow(o.id)).refundedCents === 1448 && (await itemNow(mug.id)).refundedQuantity === 1 && (await stock()) === 10, row)
  await settle()
  check('held part: the shopper is not told money came back — it has not', mails.slice(m0).filter((x) => x.to === o.customerEmail).length === 0)
  const another = await part(o.id, { items: [{ orderItemId: mug.id, quantity: 1 }] })
  const whole = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  check(`held part: another refund waits for it (${another.json?.code}, ${whole.json?.code})`, another.status === 409 && whole.status === 409 && (await orderNow(o.id)).status === 'paid')
  // The resume asks where it stands: still PENDING → still held, and nothing is sent again.
  await backdate(row.id)
  const p0 = pp.length, l0 = lookups.length
  await ordersModule.resumePendingRefunds()
  check(`held part, resume: PayPal is asked by the refund's id (GET …/refunds/${lookups[l0]}), no second refund sent`, lookups.length === l0 + 1 && lookups[l0] === row.providerRefundId && pp.length === p0 && (await rowsOf(o.id))[0].status === 'pending', { lookups: lookups.slice(l0), sent: pp.length - p0 })
  lookupMode = 'drop'; await ordersModule.resumePendingRefunds(); lookupMode = 'ok'
  check('held part, resume: PayPal not answering the lookup leaves it held (not released, not settled)', (await rowsOf(o.id))[0].status === 'pending' && (await orderNow(o.id)).refundedCents === 1448 && pp.length === p0)
  const retry = await MA('POST', `/${o.id}/refunds/${row.id}/retry`)
  check(`held part, Try again: asks after it, sends nothing (${retry.status}, awaiting ${retry.json?.refund?.awaiting})`, retry.status === 200 && retry.json?.refund?.awaiting === true && pp.length === p0)
  // PayPal completes it: the resume settles it — once.
  paypalDecides(row.providerRefundId!, 'COMPLETED')
  await ordersModule.resumePendingRefunds()
  await ordersModule.resumePendingRefunds()
  const [after] = await rowsOf(o.id)
  await settle()
  check(`held part → COMPLETED (resume): settled once — row refunded, one Mug back (10 → ${await stock()}), $14.48 counted once`, after.status === 'refunded' && after.providerRefundId === row.providerRefundId && (await stock()) === 11 && (await orderNow(o.id)).refundedCents === 1448 && pp.length === p0, after)
  check('held part → COMPLETED: now the shopper is emailed, once', mails.slice(m0).filter((x) => x.to === o.customerEmail).length === 1)
}
// 6b. The resume finds PayPal FAILED it: released exactly as a refusal is — money and units back, nothing restocked.
{
  await setStock(); const { o, mug } = await mkOrder()
  mode = 'pending'; await part(o.id, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true }); mode = 'completed'
  const [row] = await rowsOf(o.id)
  paypalDecides(row.providerRefundId!, 'FAILED')
  await backdate(row.id)
  await ordersModule.resumePendingRefunds()
  const [after] = await rowsOf(o.id); const now = await orderNow(o.id)
  check(`held part → FAILED (resume): row failed, the order has nothing back, both Mugs refundable again, nothing restocked`, after.status === 'failed' && /did not complete the refund \(failed/.test(after.error || '') && now.refundedCents === 0 && now.status === 'paid' && (await itemNow(mug.id)).refundedQuantity === 0 && (await stock()) === 10, { after, now })
  const again = await part(o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
  check('held part → FAILED: a new refund can be made, under a new request id', again.status === 200 && pp.at(-1)!.requestId !== `refund-${row.id}` && (await orderNow(o.id)).refundedCents === 1448)
}

// 7. Already refunded in PayPal's dashboard: a whole refund finds nothing left (CAPTURE_FULLY_REFUNDED) — the money is
//    back either way, so the order is marked refunded, said so, and the shopper is not emailed a second time.
{
  await setStock(); const { o } = await mkOrder(); const m0 = mails.length
  refundedOn.set('PP-CAP-' + n, 5519)
  const r = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  await settle()
  check(`already refunded: marked refunded, alreadyRefunded (${r.status})`, r.status === 200 && r.json?.refund?.alreadyRefunded === true && (await orderNow(o.id)).status === 'refunded', r.json)
  check('already refunded: nobody emailed', mails.slice(m0).filter((x) => x.to === o.customerEmail).length === 0)
}

// 8. No capture id on record: no crash, no PayPal call, a plain answer.
{
  await setStock(); const { o } = await mkOrder({ providerPaymentId: null }); const c0 = pp.length
  const r = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  check(`no capture id: recorded, PayPal not asked, told so (${r.json?.refund?.kind})`, r.status === 200 && pp.length === c0 && r.json?.refund?.kind === 'none_on_file' && /No card payment is on record/.test(r.json.refund.note), r.json)
  const { PayPalProvider } = await import('./src/payments/paypal.ts')
  const { RefundRefused } = await import('./src/payments/types.ts')
  const p = new PayPalProvider({ secretKey: 'pp-secret', publishableKey: 'pp-client', mode: 'test' })
  const t0 = tokens
  let err: any = null
  try { await p.refund({ providerPaymentId: '', idempotencyKey: 'k', amountCents: 100, currency: 'usd' }) } catch (e) { err = e }
  check(`no capture id (adapter): a RefundRefused naming the missing capture, before PayPal is called ("${err?.message?.slice(0, 60)}")`, err instanceof RefundRefused && /No PayPal capture id/.test(err.message) && tokens === t0 && pp.length === c0)
}

// 9. Amounts: cents ↔ PayPal's decimal strings, exactly, with no float in the way.
{
  const { money, cents, PayPalProvider } = await import('./src/payments/paypal.ts')
  const pairs: [number, string][] = [[1234, '12.34'], [5, '0.05'], [50, '0.50'], [100, '1.00'], [1005, '10.05'], [1999, '19.99'], [123456789, '1234567.89'], [29, '0.29'], [57, '0.57'], [0, '0.00']]
  const bad = pairs.filter(([c, s]) => money(c) !== s || cents(s) !== c)
  check(`format: cents ↔ decimal string both ways for ${pairs.length} values`, bad.length === 0, bad.map(([c, s]) => [c, s, money(c), cents(s)]))
  check('format: PayPal\'s short forms read right — "10.5" → 1050, "7" → 700, "0.07" → 7', cents('10.5') === 1050 && cents('7') === 700 && cents('0.07') === 7)
  check('format: garbage is not a number of cents', cents('1,00') === null && cents('12.345') === null && cents('abc') === null)
  let threw = false; try { money(12.5) } catch { threw = true }
  check('format: a fractional cent is refused, not rounded', threw)
  // Every cent value 0..99999 formats and parses back to itself.
  let drift = 0; for (let c = 0; c < 100000; c++) if (cents(money(c)) !== c || !/^\d+\.\d{2}$/.test(money(c))) drift++
  check(`format: 0 … $999.99 round-trips exactly (${drift} drifted)`, drift === 0)
  // Through the adapter: 1005 cents and a lower-case currency.
  const c0 = pp.length
  refundedOn.delete('PP-CAP-FMT')
  const p = new PayPalProvider({ secretKey: 'pp-secret', publishableKey: 'pp-client', mode: 'test' })
  const res = await p.refund({ providerPaymentId: 'PP-CAP-FMT', idempotencyKey: 'fmt-1', amountCents: 1005, currency: 'usd' })
  check(`format: the adapter sends {"value":"10.05","currency_code":"USD"} and reads 1005 back (${JSON.stringify(pp[c0]?.body?.amount)})`, pp[c0]?.body?.amount?.value === '10.05' && pp[c0].body.amount.currency_code === 'USD' && res.amountCents === 1005 && res.status === 'succeeded')
  let zero: any = null; try { await p.refund({ providerPaymentId: 'PP-CAP-FMT', idempotencyKey: 'fmt-2', amountCents: 0, currency: 'usd' }) } catch (e) { zero = e }
  check('format: a zero refund is refused before PayPal is asked', !!zero && pp.length === c0 + 1)
}

// ── PayPal's webhook: refund events, verified, then applied once ───────────────────────────────────
const pub = new Hono(); pub.route('/api/public', (await import('./src/routes/public.ts')).default)
let evt = 0
const hook = async (event_type: string, resource: unknown, sig = 'good-sig') => {
  const res = await pub.request('/api/public/webhooks/payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'paypal-transmission-id': `t-${++evt}`, 'paypal-transmission-time': '2026-10-17T12:00:00Z', 'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-sig': sig },
    body: JSON.stringify({ id: `WH-EVT-${evt}`, event_version: '1.0', resource_type: 'refund', event_type, resource }),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
// A Payments v2 refund resource, as PayPal documents it: id, status, amount, the running total, rel:"up" → its capture.
const refundRes = (id: string, capture: string, cents: number, totalRefunded: number | null, status = 'COMPLETED') => ({
  id, status, amount: { value: fmt(cents), currency_code: 'USD' },
  ...(totalRefunded == null ? {} : { seller_payable_breakdown: { gross_amount: { value: fmt(cents), currency_code: 'USD' }, total_refunded_amount: { value: fmt(totalRefunded), currency_code: 'USD' } } }),
  links: [{ rel: 'self', method: 'GET', href: `https://api.sandbox.paypal.com/v2/payments/refunds/${id}` }, { rel: 'up', method: 'GET', href: `https://api.sandbox.paypal.com/v2/payments/captures/${capture}` }],
})

// 11. A held part refund, then PayPal's PAYMENT.CAPTURE.REFUNDED for it: settled once — and the same notice again is nothing.
{
  await setStock(); const { o, mug } = await mkOrder(); const m0 = mails.length
  mode = 'pending'; await part(o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true }); mode = 'completed'
  const [row] = await rowsOf(o.id)
  paypalDecides(row.providerRefundId!, 'COMPLETED')
  const v0 = verifies.length
  const h = await hook('PAYMENT.CAPTURE.REFUNDED', refundRes(row.providerRefundId!, o.providerPaymentId!, 1448, 1448))
  check(`webhook completed: the notice was verified with PayPal first (webhook_id WH-TEST) and accepted (${h.status})`, h.status === 200 && verifies.length === v0 + 1 && verifies[v0].webhook_id === 'WH-TEST' && verifies[v0].webhook_event?.event_type === 'PAYMENT.CAPTURE.REFUNDED')
  const rows = await rowsOf(o.id)
  check(`webhook completed: the held part settles — refunded, one Mug back (${await stock()}), $14.48 counted once, no dashboard row`, rows.length === 1 && rows[0].status === 'refunded' && (await stock()) === 11 && (await orderNow(o.id)).refundedCents === 1448, rows)
  await hook('PAYMENT.CAPTURE.REFUNDED', refundRes(row.providerRefundId!, o.providerPaymentId!, 1448, 1448))
  await settle()
  check('webhook completed: the same notice again changes nothing (one row, one restock, one email)', (await rowsOf(o.id)).length === 1 && (await stock()) === 11 && (await orderNow(o.id)).refundedCents === 1448 && mails.slice(m0).filter((x) => x.to === o.customerEmail).length === 1)
}
// 12. A held part refund, then PAYMENT.REFUND.FAILED: the reservation goes back exactly as a refusal's does.
{
  await setStock(); const { o, mug } = await mkOrder()
  mode = 'pending'; await part(o.id, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true }); mode = 'completed'
  const [row] = await rowsOf(o.id)
  paypalDecides(row.providerRefundId!, 'FAILED')
  const h = await hook('PAYMENT.REFUND.FAILED', { ...refundRes(row.providerRefundId!, o.providerPaymentId!, 2896, null, 'FAILED'), status_details: { reason: 'ECHECK' } })
  const [after] = await rowsOf(o.id); const now = await orderNow(o.id)
  check(`webhook failed: the row reads failed (${after.error}); nothing back, both Mugs refundable, nothing restocked, still paid`, h.status === 200 && after.status === 'failed' && /did not complete the refund \(failed: ECHECK\)/.test(after.error || '') && now.refundedCents === 0 && now.status === 'paid' && (await itemNow(mug.id)).refundedQuantity === 0 && (await stock()) === 10, { after, now })
  await hook('PAYMENT.REFUND.FAILED', { ...refundRes(row.providerRefundId!, o.providerPaymentId!, 2896, null, 'FAILED'), status_details: { reason: 'ECHECK' } })
  check('webhook failed: the same notice again gives nothing back twice', (await orderNow(o.id)).refundedCents === 0 && (await itemNow(mug.id)).refundedQuantity === 0)
  const pend = await hook('PAYMENT.REFUND.PENDING', refundRes('PP-REF-X', o.providerPaymentId!, 500, null, 'PENDING'))
  check('webhook pending: PAYMENT.REFUND.PENDING is accepted and changes nothing', pend.status === 200 && (await rowsOf(o.id)).length === 1 && (await orderNow(o.id)).refundedCents === 0)
}
// 13. A held WHOLE refund: the order stays stamped (refunded, nothing restocked) until PayPal confirms it.
{
  await setStock(); const { o } = await mkOrder(); const m0 = mails.length
  mode = 'pending'
  const r = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  mode = 'completed'
  const held = await orderNow(o.id)
  check(`held whole: answered 200 awaiting; the order reads refunded with the refund still under way, nothing restocked (${r.status})`, r.status === 200 && r.json?.refund?.awaiting === true && held.status === 'refunded' && !!held.refundPendingAt && held.refundId === 'PP-REF-' + refundSeq && !held.refundError && held.refundedCents === 0 && (await stock()) === 10, held)
  paypalDecides(held.refundId!, 'COMPLETED')
  const h = await hook('PAYMENT.CAPTURE.REFUNDED', refundRes(held.refundId!, o.providerPaymentId!, 5519, 5519))
  const now = await orderNow(o.id)
  await settle()
  check(`held whole → webhook completed: settled — stamp off, $55.19 back, everything restocked (mug ${await stock()})`, h.status === 200 && !now.refundPendingAt && now.refundedCents === 5519 && !!now.refundedAt && (await stock()) === 12 && (await stock(shirtV.id)) === 11, now)
  check('held whole → completed: the shopper is emailed once', mails.slice(m0).filter((x) => x.to === o.customerEmail).length === 1)
  await hook('PAYMENT.CAPTURE.REFUNDED', refundRes(held.refundId!, o.providerPaymentId!, 5519, 5519))
  check('held whole: the notice again restocks nothing more', (await stock()) === 12 && (await rowsOf(o.id)).length === 1)
}
// 13a. A held whole refund and the 5-minute resume: asked after by its id — never sent again — and PayPal not answering
//      the lookup leaves it held; once PayPal completes it, the resume settles it.
{
  await setStock(); const { o } = await mkOrder()
  mode = 'pending'; await MA('PATCH', `/${o.id}/status`, { status: 'refunded' }); mode = 'completed'
  const held = await orderNow(o.id)
  await db.update(orders).set({ refundPendingAt: new Date(Date.now() - 10 * 60_000) }).where(eq(orders.id, o.id))
  const p0 = pp.length, l0 = lookups.length
  await ordersModule.resumePendingRefunds()
  const still = await orderNow(o.id)
  check(`held whole, resume: PayPal asked by the refund's id (${lookups.slice(l0).join(',')}), nothing sent again, still held`, lookups.slice(l0).includes(held.refundId!) && pp.length === p0 && !!still.refundPendingAt && !still.refundError && (await stock()) === 10, still)
  lookupMode = 'drop'; await ordersModule.resumePendingRefunds(); lookupMode = 'ok'
  const after = await orderNow(o.id)
  check('held whole, resume: a lookup PayPal does not answer leaves it held — no refusal written, nothing sent', !!after.refundPendingAt && !after.refundError && after.refundId === held.refundId && pp.length === p0, after)
  paypalDecides(held.refundId!, 'COMPLETED')
  await ordersModule.resumePendingRefunds()
  const done = await orderNow(o.id)
  check('held whole, resume: once PayPal completes it, settled — everything restocked, nothing sent again', !done.refundPendingAt && done.refundedCents === 5519 && (await stock()) === 12 && pp.length === p0, done)
}
// 13b. A held whole refund PayPal FAILS: kept on the order as refused (refundError), nothing restocked; Try again is a NEW
//      request — the old request id would only hand back the failed refund.
{
  await setStock(); const { o } = await mkOrder()
  mode = 'pending'; await MA('PATCH', `/${o.id}/status`, { status: 'refunded' }); mode = 'completed'
  const held = await orderNow(o.id)
  paypalDecides(held.refundId!, 'FAILED')
  await hook('PAYMENT.REFUND.FAILED', { ...refundRes(held.refundId!, o.providerPaymentId!, 5519, null, 'FAILED'), status_details: { reason: 'ECHECK' } })
  const failedNow = await orderNow(o.id)
  check(`held whole → failed: the refusal is on the order with Try again; still stamped; nothing back or restocked (${failedNow.refundError})`, !!failedNow.refundPendingAt && /did not complete the refund/.test(failedNow.refundError || '') && failedNow.refundedCents === 0 && (await stock()) === 10, failedNow)
  const p0 = pp.length
  const retry = await MA('POST', `/${o.id}/refund/retry`)
  check(`held whole → Try again: a new request id order-refund-<id>-after-<failed refund> (${pp[p0]?.requestId}), settled`, retry.status === 200 && pp.length === p0 + 1 && pp[p0].requestId === `order-refund-${o.id}-after-${held.refundId}` && !(await orderNow(o.id)).refundPendingAt && (await orderNow(o.id)).refundedCents === 5519 && (await stock()) === 12 && refundedOn.get(o.providerPaymentId!) === 5519, { call: pp[p0], r: retry.json })
}
// 14. Our own refund, completed at once, echoes back as PAYMENT.CAPTURE.REFUNDED: matched by its refund id, never counted twice.
{
  await setStock(); const { o, mug } = await mkOrder()
  await part(o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
  const [row] = await rowsOf(o.id)
  await hook('PAYMENT.CAPTURE.REFUNDED', refundRes(row.providerRefundId!, o.providerPaymentId!, 1448, 1448))
  check("echo (part): our own refund's notice adds no row and no money", (await rowsOf(o.id)).length === 1 && (await orderNow(o.id)).refundedCents === 1448 && (await stock()) === 11)
  const whole = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  const final = await orderNow(o.id)
  await hook('PAYMENT.CAPTURE.REFUNDED', refundRes(final.refundId!, o.providerPaymentId!, 4071, 5519))
  check(`echo (whole): the rest's notice changes nothing — refunded once, two rows (${whole.status})`, whole.status === 200 && (await rowsOf(o.id)).length === 2 && (await orderNow(o.id)).refundedCents === 5519 && (await stock()) === 12)
}
// 15. Refunds made in PayPal's own dashboard: a part, then the rest — each applied once, by PayPal's running total.
{
  await setStock(); const { o } = await mkOrder()
  refundedOn.set(o.providerPaymentId!, 1000)
  const a = await hook('PAYMENT.CAPTURE.REFUNDED', refundRes('DASH-1', o.providerPaymentId!, 1000, 1000))
  let rows = await rowsOf(o.id)
  check(`dashboard part: $10.00 recorded as a dashboard refund, no units restocked, still paid (${a.status})`, a.status === 200 && rows.length === 1 && rows[0].amountCents === 1000 && rows[0].moneyBack === 'provider_dashboard' && (await orderNow(o.id)).refundedCents === 1000 && (await orderNow(o.id)).status === 'paid' && (await stock()) === 10, rows)
  await hook('PAYMENT.CAPTURE.REFUNDED', refundRes('DASH-1', o.providerPaymentId!, 1000, 1000))
  check('dashboard part: the same notice again records nothing more', (await rowsOf(o.id)).length === 1 && (await orderNow(o.id)).refundedCents === 1000)
  // A second dashboard part: $5.00 this time, $15.00 in all — PayPal's running total, not this refund's own amount, is what counts.
  refundedOn.set(o.providerPaymentId!, 1500)
  await hook('PAYMENT.CAPTURE.REFUNDED', refundRes('DASH-1B', o.providerPaymentId!, 500, 1500))
  check(`dashboard part 2: $5.00 more recorded — $15.00 back in all (${(await orderNow(o.id)).refundedCents})`, (await rowsOf(o.id)).length === 2 && (await orderNow(o.id)).refundedCents === 1500 && (await orderNow(o.id)).status === 'paid')
  refundedOn.set(o.providerPaymentId!, 5519)
  await hook('PAYMENT.CAPTURE.REFUNDED', refundRes('DASH-2', o.providerPaymentId!, 4519, 5519))
  rows = await rowsOf(o.id)
  const now = await orderNow(o.id)
  check(`dashboard rest: the order is refunded in full, everything restocked once (mug ${await stock()})`, now.status === 'refunded' && now.refundedCents === 5519 && !now.refundPendingAt && (await stock()) === 12 && (await stock(shirtV.id)) === 11 && rows.length === 3, { now, rows })
  await hook('PAYMENT.CAPTURE.REFUNDED', refundRes('DASH-2', o.providerPaymentId!, 4519, 5519))
  check('dashboard rest: again, nothing more', (await stock()) === 12 && (await rowsOf(o.id)).length === 3)
}
// 16. PayPal reverses the capture (PAYMENT.CAPTURE.REVERSED): all of it has gone back — the order is refunded. (The capture
//     itself is left reading COMPLETED here: REVERSED is not one of its statuses, so the event alone has to say "all of it".)
{
  await setStock(); const { o } = await mkOrder()
  const h = await hook('PAYMENT.CAPTURE.REVERSED', refundRes('REV-1', o.providerPaymentId!, 5519, null))
  const now = await orderNow(o.id)
  check(`reversal: the order is refunded in full and restocked (${now.status}, ${now.refundedCents})`, h.status === 200 && now.status === 'refunded' && now.refundedCents === 5519 && (await stock()) === 12, now)
}
// 17. A notice PayPal does not vouch for is refused before anything is read from it.
{
  await setStock(); const { o } = await mkOrder()
  const v0 = verifies.length
  const forged = await hook('PAYMENT.CAPTURE.REFUNDED', refundRes('FORGED-1', o.providerPaymentId!, 5519, 5519), 'forged-sig')
  const unsigned = await pub.request('/api/public/webhooks/payment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event_type: 'PAYMENT.REFUND.FAILED', resource: refundRes('X', o.providerPaymentId!, 1, null, 'FAILED') }) })
  const now = await orderNow(o.id)
  check(`forged / unsigned: both refused 400, verification asked each time, the order untouched (${forged.status}, ${unsigned.status})`, forged.status === 400 && unsigned.status === 400 && verifies.length === v0 + 2 && now.status === 'paid' && now.refundedCents === 0 && (await rowsOf(o.id)).length === 0 && (await stock()) === 10)
}
// 18. The store's PayPal webhook listens to the refund events — set up on connect, and brought up to date at startup.
{
  const { ensurePayPalWebhookEvents, PAYPAL_WEBHOOK_EVENTS } = await import('./src/routes/payments.ts')
  const want = ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED', 'PAYMENT.REFUND.PENDING', 'PAYMENT.REFUND.FAILED']
  check(`webhook events: exactly the documented capture + refund events (${PAYPAL_WEBHOOK_EVENTS.join(', ')})`, want.every((e) => (PAYPAL_WEBHOOK_EVENTS as readonly string[]).includes(e)) && PAYPAL_WEBHOOK_EVENTS.length === want.length)
  hookEvents = ['PAYMENT.CAPTURE.COMPLETED']
  const first = await ensurePayPalWebhookEvents()
  const patch = hookPatches.at(-1)
  const names = patch?.[0]?.value?.map((v: any) => v.name) || []
  check(`webhook events: an older store's webhook is updated in place — PATCH replace /event_types (${first})`, first === 'updated' && patch?.[0]?.op === 'replace' && patch[0].path === '/event_types' && want.every((e) => names.includes(e)), patch)
  hookEvents = [...want]
  const n0 = hookPatches.length
  const second = await ensurePayPalWebhookEvents()
  check(`webhook events: …and left alone once current (${second})`, second === 'current' && hookPatches.length === n0)
}

// 10. WHAT is stored to refund against: the CAPTURE id, not PayPal's order id — from the success page (capture on return)
//     and from the PAYMENT.CAPTURE.COMPLETED webhook alike. finalizeOrder writes it to orders.providerPaymentId.
{
  const { PayPalProvider } = await import('./src/payments/paypal.ts')
  const completed = { id: 'PP-ORDER-X', status: 'COMPLETED', payer: { email_address: 'pat@example.com' }, purchase_units: [{ payments: { captures: [{ id: 'PP-CAP-X', status: 'COMPLETED', amount: { value: '55.19', currency_code: 'USD' } }] } }] }
  const prev = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/v1/oauth2/token')) return json({ access_token: 'A21-test-token' })
    if (url.endsWith('/v2/checkout/orders/PP-ORDER-X/capture')) return json(completed, 201)
    if (url.endsWith('/v2/checkout/orders/PP-ORDER-X')) return json({ ...completed, status: 'APPROVED', purchase_units: [{}] })
    if (url.endsWith('/v1/notifications/verify-webhook-signature')) return json({ verification_status: 'SUCCESS' })
    return json({}, 404)
  }) as any
  const p = new PayPalProvider({ secretKey: 'pp-secret', publishableKey: 'pp-client', webhookSecret: 'WH-TEST', mode: 'test' })
  const r = await p.retrieveSession('PP-ORDER-X')
  check(`capture id: the success page's capture yields the capture id to refund against (${r.providerPaymentId}), the order id as the session`, r.type === 'paid' && r.providerPaymentId === 'PP-CAP-X' && r.providerSessionId === 'PP-ORDER-X' && r.amountTotalCents === 5519, r)
  const w = await p.verifyAndParseWebhook({ rawBody: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'PP-CAP-X', amount: { value: '55.19', currency_code: 'USD' }, supplementary_data: { related_ids: { order_id: 'PP-ORDER-X' } } } }), signature: undefined, headers: {} })
  check(`capture id: …and so does the webhook (${w.providerPaymentId})`, w.type === 'paid' && w.providerPaymentId === 'PP-CAP-X' && w.providerSessionId === 'PP-ORDER-X' && w.amountTotalCents === 5519, w)
  globalThis.fetch = prev
}

globalThis.fetch = realFetch
console.log(`\npaypal refunds: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
