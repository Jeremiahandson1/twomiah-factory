// ADAPTED COPY of tests/store/label-picked-rate.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except
// the lines marked "unified:", each saying what the unified build changed and why. The original keeps running against
// the template.
// crm-store — the rate you pick is the label you get. (Live, EasyPost test mode, 10/12)
//
// Every Buy on the order page answered "That shipping rate is no longer available". Get rates created one EasyPost
// shipment and showed its rate ids; Buy created a SECOND shipment — fresh ids — and searched it for the picked id, so
// a chosen rate could never be found. The other suites' EasyPost stand-in gave every shipment the same id ('rate_1'),
// which is exactly why none of them could see it. This one answers as EasyPost does: every shipment its own rate ids.
process.env.PAYMENT_ENC_KEY ||= 'label-rate-test-key'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, users, orders, shippingConfig } from './db/schema.ts' /* unified: the shop's name is the company row's (company.name), not store_settings' */

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()
const { encryptJSON } = await import('./src/lib/crypto.ts')
await db.update(company).set({ name: 'Label Store' }) /* unified: the shop's name is the one company row's (company.name); the commerce settings row (currency usd, the default) is made on first read */
const [staff] = await db.insert(users).values({ email: 'staff@label.test', passwordHash: 'x', firstName: 'Staff', lastName: 'Tester', role: 'staff' } as any).returning() /* unified: a user's name is first and last (user.firstName/lastName) */
const ADDRESS = { line1: '1 Main St', city: 'Eau Claire', state: 'WI', postalCode: '54701', country: 'US' }
await db.insert(shippingConfig).values({ provider: 'easypost', mode: 'test', connected: true, credentialsEnc: encryptJSON({ apiKey: 'EZTK_test', mode: 'test' }), fromAddress: { ...ADDRESS, name: 'Label Store' } } as any)
let n = 0
const mkOrder = async () => (await db.insert(orders).values({
  orderNumber: `ORD-L${++n}`, provider: 'stripe', providerSessionId: `cs_l${n}`, status: 'paid', customerEmail: `s${n}@example.com`, customerName: 'Ada Lovelace', customerPhone: '+12015550123',
  subtotalCents: 2500, shippingCents: 0, taxCents: 0, totalCents: 2500, currency: 'usd', shippingAddress: ADDRESS,
} as any).returning())[0]

// ── EasyPost, as it answers: every shipment its own rate ids ─────────────────────────────────────────
const SERVICES = [['USPS', 'GroundAdvantage', '6.57'], ['USPS', 'Priority', '8.01'], ['USPS', 'Express', '32.99']]
const rateIndex = new Map<string, { carrier: string; service: string; rate: string; shipment: string }>()
let shipments = 0, offer = SERVICES
const boughtOn: { shipment: string; rate: string; service: string }[] = []
const shipTos: any[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith('https://api.easypost.com/')) return realFetch(input, init)
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  const method = (init?.method || 'GET').toUpperCase()
  if (url.endsWith('/v2/shipments') && method === 'POST') {
    shipTos.push(JSON.parse(init.body).shipment.to_address)
    const id = `shp_${++shipments}`
    const rates = offer.map(([carrier, service, rate], i) => { const rid = `rate_${shipments}_${i}`; rateIndex.set(rid, { carrier, service, rate, shipment: id }); return { id: rid, shipment_id: id, carrier, service, rate, currency: 'USD', delivery_days: 3 } })
    return json({ id, rates })
  }
  const r = url.match(/\/v2\/rates\/([^/?]+)$/)
  if (r && method === 'GET') { const x = rateIndex.get(decodeURIComponent(r[1])); return x ? json({ id: r[1], ...x, shipment_id: x.shipment }) : json({ error: { message: 'The requested resource could not be found.' } }, 404) }
  const b = url.match(/\/v2\/shipments\/([^/]+)\/buy$/)
  if (b && method === 'POST') {
    const rid = JSON.parse(init.body).rate.id; const x = rateIndex.get(rid)
    if (!x || x.shipment !== b[1]) return json({ error: { message: 'Rate not found for this shipment' } }, 422)
    boughtOn.push({ shipment: b[1], rate: rid, service: x.service })
    return json({ id: b[1], tracking_code: `TRK-${rid}`, postage_label: { label_url: `https://labels.test/${rid}.png` }, selected_rate: { carrier: x.carrier, service: x.service, rate: x.rate } })
  }
  return json({ error: { message: 'not answered here' } }, 404)
}) as any

const app = new Hono()
app.route('/api/admin/shipping', (await import('./src/routes/shipping.ts')).default)
const S = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': staff.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const orderNow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]

// 1. Pick a rate that is NOT the cheapest: that service is what is bought.
{
  const o = await mkOrder()
  const rates = await S('GET', `/api/admin/shipping/orders/${o.id}/rates`)
  const priority = (rates.json?.data || []).find((r: any) => r.service === 'Priority')
  const buy = await S('POST', `/api/admin/shipping/orders/${o.id}/label`, { rateId: priority?.id, markShipped: true })
  const now = await orderNow(o.id)
  check(`picked rate: the order page's Priority rate buys (${buy.status})`, buy.status === 200, buy.json)
  check('picked rate: …Priority, not the cheapest, on a fresh shipment for this order', boughtOn.at(-1)?.service === 'Priority' && boughtOn.at(-1)?.shipment !== rateIndex.get(priority.id)?.shipment, boughtOn.at(-1))
  check('picked rate: the order is shipped with its label, tracking and the cost of the service picked', now.status === 'shipped' && /^https:\/\/labels\.test\//.test(now.labelUrl || '') && /^TRK-/.test(now.trackingNumber || '') && now.labelCostCents === 801, now)
}
// 2. No rate picked: the cheapest, as before.
{
  const o = await mkOrder()
  const buy = await S('POST', `/api/admin/shipping/orders/${o.id}/label`, { markShipped: true })
  check(`no rate picked: the cheapest is bought (${buy.status}, ${boughtOn.at(-1)?.service})`, buy.status === 200 && boughtOn.at(-1)?.service === 'GroundAdvantage')
}
// 3. A rate id EasyPost does not know: refused in words, nothing bought, the order free to try again.
{
  const o = await mkOrder(); const before = boughtOn.length
  const buy = await S('POST', `/api/admin/shipping/orders/${o.id}/label`, { rateId: 'rate_nope', markShipped: true })
  const now = await orderNow(o.id)
  check(`unknown rate: refused, saying to get rates again (${buy.status})`, buy.status === 502 && /could not be found — get rates again/.test(buy.json?.error), buy.json)
  check('unknown rate: nothing bought, the order still paid, the claim released', boughtOn.length === before && now.status === 'paid' && !now.labelPurchasedAt)
}
// 4. The service picked is no longer offered for this address: said by name.
{
  const o = await mkOrder()
  const rates = await S('GET', `/api/admin/shipping/orders/${o.id}/rates`)
  const express = (rates.json?.data || []).find((r: any) => r.service === 'Express')
  offer = SERVICES.filter(([, s]) => s !== 'Express')
  const before = boughtOn.length
  const buy = await S('POST', `/api/admin/shipping/orders/${o.id}/label`, { rateId: express?.id, markShipped: true })
  offer = SERVICES
  check(`service gone: refused naming the service (${buy.status}) — "${buy.json?.error}"`, buy.status === 502 && /USPS Express is no longer offered for this address — get rates again/.test(buy.json?.error) && boughtOn.length === before, buy.json)
}

// 6. The parcel is addressed to the customer by name (a live USPS label read "SHIP TO: 1 MAIN ST" with no name).
check(`ship-to: every shipment names the customer and carries their phone (${shipTos.length} sent)`, shipTos.length > 0 && shipTos.every((t) => t.name === 'Ada Lovelace' && t.phone === '+12015550123' && t.street1 === '1 Main St'), shipTos[0])
// 5. In the audit log as what it was, and the print tab opened inside the click.
{
  const { auditLog } = await import('./db/schema.ts')
  const rows = (await db.select().from(auditLog)).map((r: any) => r.metadata?.description || '')
  check(`audit: a label purchase reads as one ("${rows[0]}")`, /^Shipping label bought — USPS Priority, \$8\.01, tracking TRK-rate_\d+_1; marked shipped, customer emailed$/.test(rows[0] || ''), rows)
  const page = (require('node:fs') as typeof import('node:fs')).readFileSync((process.env.FACTORY_ROOT || '').replace(/\/?$/, '/') + 'apps/unified/web/src/crm/pages/store/orders/OrderDetailPage.tsx', 'utf8').replace(/\r\n/g, '\n') /* unified: the order page moved to apps/unified/web/src/crm/pages/store/orders/OrderDetailPage.tsx */
  const buy = page.slice(page.indexOf('  const buy = async (rateId: string) => {'), page.indexOf('  return (', page.indexOf('  const buy = async'))) /* unified: the moved page's buy takes the picked rate's id (rateId: string) */
  check('screen: the print tab is opened inside the click, before the purchase is awaited, and closed if it fails',
    buy.indexOf("const printTab = window.open('', '_blank')") >= 0 && buy.indexOf("const printTab = window.open('', '_blank')") < buy.indexOf('await api.post(`/api/admin/shipping/orders/') && /printTab\.location\.href = res\.label\.labelUrl/.test(buy) && /printTab\?\.close\(\)/.test(buy) && !/window\.open\(res\.label/.test(buy)) /* unified: the purchase is the page's api.post to /api/admin/shipping/orders/:id/label (the template's api.buyLabel helper is not carried) */
}

globalThis.fetch = realFetch
console.log(`\nlabel picked rate: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
