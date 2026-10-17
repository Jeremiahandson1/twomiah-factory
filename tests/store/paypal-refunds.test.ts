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
const byRequestId = new Map<string, { id: string; cents: number; status: string }>()
const refundedOn = new Map<string, number>()
let tokens = 0, refundSeq = 0
let mode: 'completed' | 'pending' | 'error500' | 'drop' | 'refuse' | 'failed' | 'badauth' = 'completed'
const mails: any[] = []
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
      const r = { id: `PP-REF-${++refundSeq}`, cents: want, status: 'FAILED' }
      if (requestId) byRequestId.set(requestId, r)
      return json({ id: r.id, status: 'FAILED', status_details: { reason: 'ECHECK' }, amount: { value: fmt(want), currency_code: 'USD' } }, 201)
    }
    const r = { id: `PP-REF-${++refundSeq}`, cents: want, status: mode === 'pending' ? 'PENDING' : 'COMPLETED' }
    if (requestId) byRequestId.set(requestId, r)
    refundedOn.set(capture, (refundedOn.get(capture) || 0) + want)
    // The refund WENT THROUGH at PayPal, but the answer never made it back.
    if (mode === 'error500') return json({ name: 'INTERNAL_SERVER_ERROR', message: 'An internal server error occurred.' }, 500)
    return json({ id: r.id, status: r.status, amount: { value: fmt(want), currency_code: 'USD' } }, 201)
  }
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

// 6. PENDING: PayPal accepted it and is still settling — taken as sent, the way Square's PENDING is.
{
  await setStock(); const { o, mug } = await mkOrder()
  mode = 'pending'
  const a = await part(o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
  const w = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  mode = 'completed'
  const rows = await rowsOf(o.id)
  check(`PENDING part: settled as sent, status pending (${a.json?.refund?.status})`, a.status === 200 && a.json?.refund?.kind === 'refunded' && a.json.refund.status === 'pending' && rows.some((x) => x.amountCents === 1448 && x.status === 'refunded'), a.json)
  check(`PENDING whole: the order is refunded, status pending passed through (${w.json?.refund?.status})`, w.status === 200 && w.json?.refund?.status === 'pending' && (await orderNow(o.id)).status === 'refunded' && refundedOn.get('PP-CAP-' + n) === 5519)
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

globalThis.fetch = realFetch
console.log(`\npaypal refunds: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
