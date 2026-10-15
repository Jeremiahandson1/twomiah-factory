// crm-store — refund PART of an order. (E2E Run 2, 10/15)
//
//   "There is no way to refund one item. Refund sends back the whole $40.71 — Shopify lets you pick the items, the
//    shipping and the amount."
//
// Asserted through the real orders routes, the real permissions module and the real Square adapter; Square's HTTP API
// is answered here in the shapes read back from the Square sandbox on 10/15 (a part refund answers PENDING, the same
// key answers the same refund, more than is left is a 400 REFUND_AMOUNT_INVALID). Email (Resend) is stubbed too.
process.env.PAYMENT_ENC_KEY ||= 'part-refunds-test-key'
process.env.RESEND_API_KEY = 'test-resend'
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { storeSettings, users, orders, orderItems, orderRefunds, products, productVariants, paymentConfig, auditLog } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

await setupSchema()
const { encryptJSON, encrypt } = await import('./src/lib/crypto.ts')
await db.insert(storeSettings).values({ companyName: 'Part Shop', currency: 'usd', supportEmail: 'owner@part.test' } as any)
await db.insert(paymentConfig).values({ provider: 'square', mode: 'test', connected: true, credentialsEnc: encryptJSON({ secretKey: 'sq-sandbox-token', publishableKey: 'LOC1' }), webhookSecretEnc: encrypt('sq-sig') } as any)
const mk = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@part.test`, passwordHash: 'x', name, role } as any).returning())[0]
const owner = await mk('owner', 'Olive Owner'), managerA = await mk('manager', 'manager-a'), managerB = await mk('manager', 'manager-b'), staff = await mk('staff', 'staff')
const [product] = await db.insert(products).values({ slug: 'mug', name: 'Mug', status: 'active' } as any).returning()
const [mugV] = await db.insert(productVariants).values({ productId: product.id, sku: 'MUG-1', name: 'Default', priceCents: 1500, inventoryQty: 10 } as any).returning()
const [shirtV] = await db.insert(productVariants).values({ productId: product.id, sku: 'SHIRT-L', name: 'Large', priceCents: 2200, inventoryQty: 10 } as any).returning()
const stock = async (v = mugV.id) => (await db.select().from(productVariants).where(eq(productVariants.id, v)))[0].inventoryQty
const setStock = async (n = 10) => { await db.update(productVariants).set({ inventoryQty: n }).where(eq(productVariants.id, mugV.id)); await db.update(productVariants).set({ inventoryQty: n }).where(eq(productVariants.id, shirtV.id)) }

// 2 Mugs at $15 + 1 Shirt at $22 = $52.00, 10% off (−$5.20), shipping $5.00, tax $3.39 → $55.19.
let n = 0
const mkOrder = async (extra: Record<string, unknown> = {}) => {
  n++
  const [o] = await db.insert(orders).values({
    orderNumber: `ORD-P${n}`, provider: 'square', providerSessionId: `sq_ord_${n}`, providerPaymentId: `sq_pay_${n}`, status: 'paid',
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

// ── Square and Resend, answered here ───────────────────────────────────────────────────────────────
type SqCall = { key: string; amount: number; currency: string; paymentId: string; reason?: string; auth: string | null }
const sq: SqCall[] = []
const byKey = new Map<string, { id: string; amount: number }>()
const refundedOn = new Map<string, number>()
let mode: 'ok' | 'refuse' | 'drop' | 'completed' = 'ok'
const mails: any[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (url === 'https://api.resend.com/emails') { mails.push(JSON.parse(init.body)); return json({ id: 'm' }) }
  if (!url.startsWith('https://connect.squareupsandbox.com/')) return realFetch(input, init)
  const method = (init?.method || 'GET').toUpperCase()
  if (url.endsWith('/v2/refunds') && method === 'POST') {
    const b = JSON.parse(init.body)
    sq.push({ key: b.idempotency_key, amount: b.amount_money?.amount, currency: b.amount_money?.currency, paymentId: b.payment_id, reason: b.reason, auth: new Headers(init.headers).get('authorization') })
    await new Promise((r) => setTimeout(r, 20))
    if (mode === 'drop') throw new TypeError('fetch failed')
    if (mode === 'refuse') return json({ errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'REFUND_AMOUNT_INVALID', detail: 'The requested refund amount exceeds the amount available to refund.' }] }, 400)
    const seen = byKey.get(b.idempotency_key)
    if (seen) return json({ refund: { id: seen.id, status: 'PENDING', amount_money: { amount: seen.amount, currency: 'USD' } } })
    const r = { id: `sq_ref_${byKey.size + 1}`, amount: b.amount_money.amount }
    byKey.set(b.idempotency_key, r)
    refundedOn.set(b.payment_id, (refundedOn.get(b.payment_id) || 0) + r.amount)
    return json({ refund: { id: r.id, status: mode === 'completed' ? 'COMPLETED' : 'PENDING', amount_money: { amount: r.amount, currency: 'USD' }, payment_id: b.payment_id } })
  }
  const pay = url.match(/\/v2\/payments\/([^/?]+)$/)
  if (pay && method === 'GET') return json({ payment: { id: pay[1], status: 'COMPLETED', amount_money: { amount: 5519, currency: 'USD' }, refunded_money: { amount: refundedOn.get(pay[1]) || 0, currency: 'USD' } } })
  return json({ errors: [{ code: 'NOT_FOUND' }] }, 404)
}) as any

const ordersModule = await import('./src/routes/orders.ts')
const app = new Hono()
app.route('/api/admin/orders', ordersModule.default)
const call = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api/admin/orders${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = call(owner), MA = call(managerA), MB = call(managerB), S = call(staff)
const part = (who: typeof O, id: string, body: unknown) => who('POST', `/${id}/refunds`, body)
const quote = (who: typeof O, id: string, body: unknown) => who('POST', `/${id}/refunds/quote`, body)
const settle = () => new Promise((r) => setTimeout(r, 50))   // the shopper email is sent without being awaited

// 1. What the units are worth: each unit's share of what was paid for goods — the discount and tax in proportion.
{
  const { o, mug, shirt } = await mkOrder()
  const q1 = await quote(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }] })
  check(`quote: one $15 Mug of a $55.19 order (10% off, tax in) is worth $14.48 back (${q1.json?.quote?.suggestedCents})`, q1.status === 200 && q1.json.quote.suggestedCents === 1448 && q1.json.quote.maxCents === 5519 && q1.json.quote.shippingLeftCents === 500, q1.json)
  const q2 = await quote(MA, o.id, { items: [{ orderItemId: shirt.id, quantity: 1 }], shippingCents: 500 })
  check(`quote: the Shirt and the shipping — $21.23 + $5.00 (${q2.json?.quote?.suggestedCents})`, q2.json?.quote?.suggestedCents === 2623, q2.json)
  const q3 = await quote(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 2 }, { orderItemId: shirt.id, quantity: 1 }], shippingCents: 500 })
  check('quote: everything that is left is exactly what is left — rounding never strands a cent', q3.json?.quote?.suggestedCents === 5519, q3.json)
  const q4 = await quote(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 3 }] })
  check(`quote: more Mugs than were bought is refused, by name (${q4.json?.error})`, q4.status === 400 && /Only 2 of Mug can still be refunded/.test(q4.json?.error), q4.json)
  const q5 = await quote(MA, o.id, { items: [], shippingCents: 600 })
  check('quote: more shipping than was charged is refused', q5.status === 400 && /of the shipping can still be refunded/.test(q5.json?.error), q5.json)
  check('quote: nothing is written by a quote', (await rowsOf(o.id)).length === 0 && (await orderNow(o.id)).refundedCents === 0)
}

// 2. One Mug back through Square: that amount, its own key, one unit restocked, the order still paid, the shopper told.
{
  await setStock(); const { o, mug } = await mkOrder(); const c0 = sq.length, m0 = mails.length
  const r = await part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true, reason: 'Arrived chipped' })
  const [row] = await rowsOf(o.id)
  check(`Square: the part refund is sent to Square for $14.48 on the order's payment (${r.status})`, r.status === 200 && sq.length === c0 + 1 && sq[c0].amount === 1448 && sq[c0].currency === 'USD' && sq[c0].paymentId === o.providerPaymentId && sq[c0].auth === 'Bearer sq-sandbox-token', { r: r.json, call: sq[c0] })
  check(`Square: …under the refund's own key, refund-<id> — ${sq[c0]?.key?.length} characters, inside Square's 45`, sq[c0]?.key === `refund-${row?.id}` && sq[c0].key.length <= 45, sq[c0])
  check('Square: …with the reason the owner gave', sq[c0]?.reason === 'Arrived chipped')
  check("Square: the refund row reads refunded, with Square's refund id and who made it", row?.status === 'refunded' && row.providerRefundId === 'sq_ref_1' && row.amountCents === 1448 && row.createdByName === 'manager-a' && row.items.length === 1 && row.items[0].quantity === 1, row)
  const now = await orderNow(o.id)
  check('Square: the order is still paid, with $14.48 back', now.status === 'paid' && now.refundedCents === 1448, now)
  check('Square: one Mug back on the shelf (10 → 11), the Shirt untouched', (await stock()) === 11 && (await stock(shirtV.id)) === 10)
  check('Square: the Mug line says one of its two is refunded', (await itemNow(mug.id)).refundedQuantity === 1)
  check('Square: the reply carries the order with its refund history', r.json?.order?.refunds?.length === 1 && r.json.order.refundedCents === 1448 && r.json.restocked === 1, r.json?.order)
  await settle()
  const mail = mails.slice(m0).find((m) => m.to === o.customerEmail)
  check(`Square: the shopper is emailed what came back ("${mail?.subject}")`, !!mail && /\$14\.48 refunded on your Part Shop order ORD-P2/.test(mail.subject) && /Mug/.test(mail.html) && /\$14\.48/.test(mail.html) && /\$14\.48/.test(mail.text || ''), mail?.subject)
  const audit = (await db.select().from(auditLog)).filter((a: any) => a.entityId === o.id)
  check(`Square: the audit log says what, how much and what was restocked ("${(audit.at(-1)?.metadata as any)?.description}")`, audit.length === 1 && /Part refund — \$14\.48 \(1 × Mug\), sent back to the card, 1 unit back in stock/.test((audit[0].metadata as any)?.description), audit.map((a: any) => a.metadata))
  const got = await O('GET', `/${o.id}`)
  check('read: the order page gets the refund history and each line\'s refunded units', got.json?.order?.refunds?.[0]?.id === row.id && got.json.order.items.find((i: any) => i.id === mug.id)?.refundedQuantity === 1)
  const staffRead = await S('GET', `/${o.id}`)
  check("read: staff see the refund but not Square's refund id", staffRead.status === 200 && staffRead.json.order.refunds[0].amountCents === 1448 && !('providerRefundId' in staffRead.json.order.refunds[0]), staffRead.json?.order?.refunds)
}

// 3. Who may: refunding is orders:refund — staff are refused, quote and refund alike, and nothing moves.
{
  const { o, mug } = await mkOrder(); const c0 = sq.length
  const a = await part(S, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }] })
  const b = await quote(S, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }] })
  check(`seats: staff are refused a part refund and a quote (${a.status}, ${b.status})`, a.status === 403 && b.status === 403 && sq.length === c0 && (await orderNow(o.id)).refundedCents === 0)
}

// 4. Refused by Square: nothing sent, so the reservation goes back — money, units and stock as they were.
{
  await setStock(); const { o, mug } = await mkOrder()
  mode = 'refuse'
  const r = await part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true })
  mode = 'ok'
  const [row] = await rowsOf(o.id)
  check(`refused: a 502 refund_failed in Square's words (${r.status})`, r.status === 502 && r.json?.code === 'refund_failed' && /exceeds the amount available/.test(r.json?.error) && /nothing was sent back/.test(r.json?.error), r.json)
  check('refused: the row reads failed with the reason; the order has nothing back and both Mugs are still refundable', row?.status === 'failed' && /exceeds/.test(row.error || '') && (await orderNow(o.id)).refundedCents === 0 && (await itemNow(mug.id)).refundedQuantity === 0, row)
  check('refused: …and nothing was restocked', (await stock()) === 10)
  const again = await part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true })
  check('refused: once Square accepts, the same refund goes through', again.status === 200 && (await orderNow(o.id)).refundedCents === 2896 && (await stock()) === 12, again.json)
}

// 5. Square does not answer: it may have gone through, so it WAITS — reserved, retried under the same key, never twice.
{
  await setStock(); const { o, mug, shirt } = await mkOrder(); const c0 = sq.length, m0 = mails.length
  mode = 'drop'
  const r = await part(MA, o.id, { items: [{ orderItemId: shirt.id, quantity: 1 }], restock: true })
  mode = 'ok'
  const [row] = await rowsOf(o.id)
  check(`no answer: a 502 refund_unconfirmed saying it waits and is never sent twice (${r.status})`, r.status === 502 && r.json?.code === 'refund_unconfirmed' && /never be sent twice/.test(r.json?.error), r.json)
  check('no answer: the row is pending, the money and the Shirt stay reserved, nothing restocked yet', row?.status === 'pending' && !!row.error && (await orderNow(o.id)).refundedCents === 2123 && (await itemNow(shirt.id)).refundedQuantity === 1 && (await stock(shirtV.id)) === 10, row)
  const second = await part(MB, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }] })
  check(`no answer: another part refund waits for it (${second.status} ${second.json?.code})`, second.status === 409 && second.json?.code === 'refund_in_progress')
  const whole = await MB('PATCH', `/${o.id}/status`, { status: 'refunded' })
  check(`no answer: so does Refund the rest — "the rest" is not known yet (${whole.status} ${whole.json?.code})`, whole.status === 409 && whole.json?.code === 'refund_in_progress' && (await orderNow(o.id)).status === 'paid')
  const retry = await MA('POST', `/${o.id}/refunds/${row.id}/retry`)
  check(`no answer: Try again asks Square under the SAME key (${retry.status})`, retry.status === 200 && sq.length === c0 + 2 && sq[c0 + 1].key === sq[c0].key && sq[c0 + 1].amount === 2123, sq.slice(c0))
  const [after] = await rowsOf(o.id)
  check('no answer: …it settles once: refunded, the Shirt back on the shelf', after.status === 'refunded' && (await stock(shirtV.id)) === 11 && (await orderNow(o.id)).refundedCents === 2123)
  const twice = await MA('POST', `/${o.id}/refunds/${row.id}/retry`)
  check('no answer: a second Try again on a settled refund sends nothing and restocks nothing', twice.status === 200 && sq.length === c0 + 2 && (await stock(shirtV.id)) === 11)
  await settle()
  check('no answer: the shopper is emailed once', mails.slice(m0).filter((m) => m.to === o.customerEmail).length === 1)
}

// 6. Interrupted (the server restarted while Square was being asked): finished on its own, same key.
{
  await setStock(); const { o, mug } = await mkOrder()
  mode = 'drop'; await part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true }); mode = 'ok'
  const [row] = await rowsOf(o.id)
  await db.update(orderRefunds).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(orderRefunds.id, row.id))
  const c0 = sq.length
  const found = await ordersModule.resumePendingRefunds()
  const [after] = await rowsOf(o.id)
  check(`resume: a part refund left waiting is asked again and settled (${found} found)`, found >= 1 && sq.length === c0 + 1 && sq[c0].key === `refund-${row.id}` && after.status === 'refunded' && (await stock()) === 11, { after, calls: sq.slice(c0) })
  await ordersModule.resumePendingRefunds()
  check('resume: running it again does nothing more', sq.length === c0 + 1 && (await stock()) === 11)
}

// 7. Two managers at once on the last Mug: one refund, one restock.
{
  await setStock(); const { o, mug } = await mkOrder()
  await part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
  const c0 = sq.length
  const rs = await Promise.all([
    part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true }),
    part(MB, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true }),
  ])
  const codes = rs.map((r) => r.status).sort().join(',')
  check(`twice at once: one goes through, the other is told (${codes})`, codes === '200,409' && rs.some((r) => ['order_changed', 'refund_in_progress', 'invalid_refund'].includes(r.json?.code)), rs.map((r) => r.json?.code || r.json?.error))
  check(`twice at once: Square asked once, the Mug restocked once (10 → ${await stock()})`, sq.length === c0 + 1 && (await stock()) === 12 && (await itemNow(mug.id)).refundedQuantity === 2)
}

// 8. Refund the rest after a part: only what is left goes back, only the units not refunded go back on the shelf.
{
  await setStock(); const { o, mug, shirt } = await mkOrder()
  await part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: false })
  check('no restock: a part refund that keeps the unit off the shelf restocks nothing', (await stock()) === 10)
  const c0 = sq.length
  const r = await MA('PATCH', `/${o.id}/status`, { status: 'refunded' })
  const now = await orderNow(o.id)
  check(`the rest: Square is sent $55.19 − $14.48 = $40.71 (${sq[c0]?.amount})`, r.status === 200 && sq.length === c0 + 1 && sq[c0].amount === 4071 && sq[c0].key.length <= 45, sq[c0])
  check('the rest: the order is refunded, its refundedCents its total', now.status === 'refunded' && now.refundedCents === 5519)
  check(`the rest: only the Mug and the Shirt not yet refunded go back (mug 10 → ${await stock()}, shirt 10 → ${await stock(shirtV.id)})`, (await stock()) === 11 && (await stock(shirtV.id)) === 11)
  check('the rest: every unit now reads refunded', (await itemNow(mug.id)).refundedQuantity === 2 && (await itemNow(shirt.id)).refundedQuantity === 1)
  const rows = await rowsOf(o.id)
  const rest = rows.find((x) => x.amountCents === 4071)
  check('the rest: the refund history has it as its own row — the units, the shipping and who', rows.length === 2 && !!rest && rest.status === 'refunded' && rest.shippingCents === 500 && rest.items.length === 2 && rest.createdByName === 'manager-a', rows)
  const more = await part(MA, o.id, { items: [], amountCents: 100 })
  check('the rest: a refunded order has nothing left to refund', more.status === 409 && more.json?.code === 'nothing_to_refund')
}

// 9. The last part closes the order: refunded, as a whole refund would leave it.
{
  await setStock(); const { o, mug, shirt } = await mkOrder()
  await part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true })
  const last = await part(MA, o.id, { items: [{ orderItemId: shirt.id, quantity: 1 }], shippingCents: 500, restock: true })
  const now = await orderNow(o.id)
  check(`last part: refunding what is left marks the order refunded (${now.status}, ${now.refundedCents})`, last.status === 200 && now.status === 'refunded' && now.refundedCents === 5519 && !!now.refundedAt)
  const audit = (await db.select().from(auditLog)).filter((a: any) => a.entityId === o.id)
  check('last part: the audit row says the order is now refunded', /nothing left to refund, so the order is refunded/.test((audit.at(-1)?.metadata as any)?.description || ''), audit.at(-1)?.metadata)
}

// 10. An amount of the owner's choosing — a goodwill refund with no items — and its limits.
{
  await setStock(); const { o } = await mkOrder()
  const r = await part(O, o.id, { items: [], amountCents: 500, reason: 'Late delivery' })
  check('goodwill: $5.00 back with no items, nothing restocked', r.status === 200 && (await orderNow(o.id)).refundedCents === 500 && (await stock()) === 10 && (await orderNow(o.id)).status === 'paid', r.json)
  const over = await part(O, o.id, { items: [], amountCents: 5100 })
  check(`goodwill: more than is left is refused before Square is asked (${over.json?.error})`, over.status === 400 && /At most \$50\.19/.test(over.json?.error))
  const zero = await part(O, o.id, { items: [] })
  check('goodwill: nothing chosen and no amount is refused', zero.status === 400)
}

// 11. Square's notice of our own refund is not counted twice; one made in Square's dashboard is recorded.
{
  await setStock(); const { o, mug } = await mkOrder()
  await part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
  const echo = await ordersModule.applyProviderRefund('square', o.providerPaymentId!, 1448, 5519)
  check(`dashboard: the echo of our own part refund changes nothing (${echo})`, echo === 'ignored' && (await rowsOf(o.id)).length === 1 && (await orderNow(o.id)).refundedCents === 1448)
  const extra = await ordersModule.applyProviderRefund('square', o.providerPaymentId!, 2448, 5519)
  const rows = await rowsOf(o.id)
  check(`dashboard: $10.00 more refunded in Square's dashboard is recorded, no units restocked (${extra})`, extra === 'partial' && rows.length === 2 && rows.some((x) => x.amountCents === 1000 && x.moneyBack === 'provider_dashboard') && (await orderNow(o.id)).refundedCents === 2448 && (await stock()) === 11, rows)
  const full = await ordersModule.applyProviderRefund('square', o.providerPaymentId!, 5519, 5519)
  const now = await orderNow(o.id)
  check(`dashboard: the rest refunded there marks the order refunded and restocks only what was not (${full})`, full === 'refunded' && now.status === 'refunded' && now.refundedCents === 5519 && (await stock()) === 12 && (await stock(shirtV.id)) === 11)
}

// 12. Square's webhook: a payment with refunded_money is a refund notice, not a second "paid".
{
  const { SquareProvider } = await import('./src/payments/square.ts')
  const crypto = await import('node:crypto')
  process.env.BACKEND_URL = 'https://shop-api.test'
  const p = new SquareProvider({ secretKey: 't', publishableKey: 'LOC1', webhookSecret: 'sig', mode: 'test' } as any)
  const body = JSON.stringify({ data: { object: { payment: { id: 'sq_pay_x', order_id: 'ord_x', status: 'COMPLETED', amount_money: { amount: 5519, currency: 'USD' }, refunded_money: { amount: 1448, currency: 'USD' } } } } })
  const sig = crypto.createHmac('sha256', 'sig').update('https://shop-api.test/api/public/webhooks/payment' + body).digest('base64')
  const res = await p.verifyAndParseWebhook({ rawBody: body, signature: sig })
  check(`webhook: Square's payment.updated with money refunded reads as a refund of $14.48 (${res.type})`, res.type === 'refunded' && res.amountRefundedCents === 1448 && res.amountTotalCents === 5519 && res.providerPaymentId === 'sq_pay_x', res)
}

// 12b. Two presses of Try again at once on a waiting refund: settled once, restocked once.
{
  await setStock(); const { o, mug } = await mkOrder()
  mode = 'drop'; await part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true }); mode = 'ok'
  const [row] = await rowsOf(o.id)
  const rs = await Promise.all([MA('POST', `/${o.id}/refunds/${row.id}/retry`), MB('POST', `/${o.id}/refunds/${row.id}/retry`)])
  check(`retry twice at once: both answer, the Mugs go back once (10 → ${await stock()})`, rs.every((r) => r.status === 200) && (await stock()) === 12 && (await rowsOf(o.id))[0].status === 'refunded', rs.map((r) => r.status))
  const audits = (await db.select().from(auditLog)).filter((a: any) => a.entityId === o.id && /tried again/.test((a.metadata as any)?.description || ''))
  check('retry twice at once: one audit row for the one refund', audits.length === 1, audits.length)
}

// 12c. Goodwill refunds racing past the total: $30 + $30 on a $55.19 order — one goes through, never both.
{
  const { o } = await mkOrder()
  const rs = await Promise.all([part(MA, o.id, { items: [], amountCents: 3000 }), part(MB, o.id, { items: [], amountCents: 3000 })])
  const now = await orderNow(o.id)
  check(`racing past the total: one $30.00 refund, the other refused (${rs.map((r) => r.status).sort().join(',')}, ${now.refundedCents} back)`, rs.map((r) => r.status).sort().join(',') === '200,409' && now.refundedCents === 3000 && now.refundedCents <= now.totalCents)
}

// 13. A provider whose refund is not built here (PayPal): recorded only, nobody asked, nobody emailed.
{
  const { o, mug } = await mkOrder({ provider: 'paypal', providerSessionId: 'pp_1', providerPaymentId: 'pp_cap_1' }); const c0 = sq.length, m0 = mails.length
  const r = await part(MA, o.id, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
  const [row] = await rowsOf(o.id)
  await settle()
  check(`PayPal: recorded only — the owner is told to refund in PayPal (${r.json?.refund?.kind})`, r.status === 200 && r.json?.refund?.kind === 'manual' && /PayPal dashboard/.test(r.json.refund.note) && row?.status === 'recorded' && sq.length === c0 && mails.slice(m0).length === 0, r.json)
}

// 14. The dashboard counts a part refund, and the net beside it.
{
  const st = (await O('GET', '/stats')).json?.stats
  const all = await db.select().from(orders)
  const back = all.filter((o) => !['pending', 'cancelled'].includes(o.status)).reduce((a, o) => a + o.refundedCents, 0)
  check(`dashboard: refundedCents is everything sent back, part refunds included (${st?.refundedCents})`, st?.refundedCents === back && back > 0, st)
  check('dashboard: net = revenue − refunds', st?.netCents === st?.revenueCents - st?.refundedCents)
  const staffSt = (await S('GET', '/stats')).json?.stats
  check('dashboard: staff are not shown the money — refunds and net are null', staffSt?.refundedCents === null && staffSt?.netCents === null, staffSt)
}

// 15. Orders refunded before part refunds existed: the migration says their whole total went back, every unit with it.
{
  const [old] = await db.insert(orders).values({ orderNumber: 'ORD-OLD', provider: 'stripe', providerSessionId: 'cs_old', status: 'refunded', customerEmail: 'old@example.com', subtotalCents: 2000, totalCents: 2000, currency: 'usd' } as any).returning()
  const [oldItem] = await db.insert(orderItems).values({ orderId: old.id, productName: 'Old', variantName: 'Default', sku: 'O', unitPriceCents: 1000, quantity: 2, lineTotalCents: 2000 } as any).returning()
  const ROOT = (process.env.FACTORY_ROOT || '').replace(/\\/g, '/').replace(/\/?$/, '/')
  const sqlText = readFileSync(ROOT + 'templates/crm-store/backend/db/migrations/0013_partial_refunds.sql', 'utf8')
  for (const stmt of sqlText.split('--> statement-breakpoint').filter((s) => /^\s*(--[^\n]*\n\s*)*UPDATE/i.test(s))) await (db as any).execute(stmt)
  check('migration: an order refunded before reads its whole total refunded', (await orderNow(old.id)).refundedCents === 2000)
  check('migration: …and every unit refunded', (await itemNow(oldItem.id)).refundedQuantity === 2)
}

// 16. The screen: a Refund items dialog that asks the server for the amount, says it on the button, and shows history.
{
  const ROOT = (process.env.FACTORY_ROOT || '').replace(/\\/g, '/').replace(/\/?$/, '/')
  const src = readFileSync(ROOT + 'templates/crm-store/frontend/src/pages/OrderDetailPage.tsx', 'utf8').replace(/\r\n/g, '\n')
  check('screen: the order page offers Refund items… to orders:refund, while money is left', /Refund items…/.test(src) && /\(order\.refundedCents \|\| 0\) < order\.totalCents && may\('orders:refund'\)/.test(src))
  check('screen: the dialog asks the server what the units are worth (quoteRefund) and sends the amount shown', /api\.quoteRefund\(order\.id, ask\)/.test(src) && /api\.refundPart\(order\.id, \{ \.\.\.ask, amountCents: cents/.test(src))
  check('screen: the button names the exact amount, and it asks first', /`Refund \$\{money\(cents, order\.currency\)\}`/.test(src) && /if \(!confirm\(`\$\{what\}/.test(src))
  check('screen: the refund history shows each refund, with Try again on one still waiting', /function RefundHistory/.test(src) && /r\.status === 'pending' && may\('orders:refund'\)/.test(src))
  check('screen: the whole refund asks for what is left, not the total', /money\(order\.totalCents - \(order\.refundedCents \|\| 0\), order\.currency\)/.test(src))
}

globalThis.fetch = realFetch
console.log(`\npart refunds: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
