// ADAPTED COPY of tests/store/qa-t3-manager.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged
// except the lines marked "unified:", where the unified build changed the schema, a reply's shape, where a screen lives,
// or a behaviour the cutover ledger lists. The original keeps running against the template.
// crm-store — the manager pass (Store QA T3).
//
//   L1 "I saved a carrier and tracking number on the cancelled order QA-ROLES-2 (200), although changing its status to
//      shipped is refused. The order page also shows the Fulfillment form on a cancelled order."
//   L2 "Settings and Payments have editable fields and enabled 'Add zone' and 'Add rate' buttons, but Save and Connect
//      are disabled. Read-only fields would be clearer."
//
// L1 is a rule — tracking is the parcel's, so only an order going out or gone out carries it (orders.ts hasParcel) —
// and its sibling: a label bought with markShipped: false skipped every status check, so the carrier could be paid
// for a label on a cancelled order. Both asserted through the real routes behind the real permissions module.
// L2 is the screens: asserted from their source here, and measured live in the browser.
process.env.PAYMENT_ENC_KEY ||= 'qa-t3-manager-test-key'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, storeSettings, users, orders, shippingConfig } from './db/schema.ts' /* unified: the business is the company row (decision 1) */

const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()
let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()
const { encryptJSON } = await import('./src/lib/crypto.ts')
await db.update(company).set({ name: 'Manager Pass Store' } as any) /* unified: the shop's name is the company row's (decision 1) */
await db.insert(storeSettings).values({ currency: 'usd' } as any) /* unified: the commerce settings keep the currency */
const mkUser = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@t3.test`, passwordHash: 'x', firstName: name, lastName: 'T3', role } as any).returning())[0] /* unified: a user's first and last name, not name */
const manager = await mkUser('manager', 'manager')
const staff = await mkUser('staff', 'staff')

const ADDRESS = { name: 'Ada', line1: '1 Main St', city: 'Madison', state: 'WI', postalCode: '53703', country: 'US' }
let n = 0
const mkOrder = async (status: string, extra: Record<string, unknown> = {}) => {
  n++
  const [o] = await db.insert(orders).values({
    orderNumber: `ORD-T3-${n}`, provider: 'stripe', providerSessionId: `sess_t3_${n}`, status,
    customerEmail: `shopper${n}@example.com`, subtotalCents: 3000, shippingCents: 0, taxCents: 0,
    totalCents: 3000, currency: 'usd', shippingAddress: ADDRESS, ...extra,
  } as any).returning()
  return o
}
const orderNow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]

// ── EasyPost, answered here: counts every label the carrier would have charged for ──────────────────
let bought = 0, quoted = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith('https://api.easypost.com/')) return realFetch(input, init)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/shipments')) { quoted++; return json({ id: `shp_${quoted}`, rates: [{ id: 'rate_1', carrier: 'USPS', service: 'Ground', rate: '7.25' }] }) }
  if (url.endsWith('/buy')) { bought++; return json({ id: 'shp_x', tracking_code: `TRK${bought}`, postage_label: { label_url: `https://labels.test/${bought}.pdf` }, selected_rate: { carrier: 'USPS', service: 'Ground', rate: '7.25' } }) }
  return json({}, 404)
}) as any
await db.insert(shippingConfig).values({
  provider: 'easypost', mode: 'test', connected: true,
  credentialsEnc: encryptJSON({ apiKey: 'EZTK_test_key', mode: 'test' }), fromAddress: ADDRESS,
} as any)

const app = new Hono()
app.route('/api/admin/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/admin/shipping', (await import('./src/routes/shipping.ts')).default)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const M = as(manager), S = as(staff)
const fulfil = (who: typeof M, id: string, body: unknown) => who('PATCH', `/api/admin/orders/${id}/fulfillment`, body)

// ── L1: tracking only where there is a parcel ──────────────────────────────────────────────────────
{
  const o = await mkOrder('cancelled')
  const r = await fulfil(M, o.id, { trackingCarrier: 'UPS', trackingNumber: '1Z999' })
  const now = await orderNow(o.id)
  check(`L1: tracking on a cancelled order is refused (409 no_parcel — ${r.status} ${r.json?.code})`, r.status === 409 && r.json?.code === 'no_parcel' && /cancelled and never went out/.test(r.json?.error), r.json)
  check('L1: …and nothing of it is saved', !now.trackingCarrier && !now.trackingNumber && now.status === 'cancelled' && !now.fulfilledAt, now)
  const carrierOnly = await fulfil(M, o.id, { trackingCarrier: 'UPS' })
  check('L1: …a carrier alone is tracking too (409)', carrierOnly.status === 409 && carrierOnly.json?.code === 'no_parcel', carrierOnly.json)
  const note = await fulfil(M, o.id, { internalNote: 'customer changed their mind' })
  check('L1: the internal note on a cancelled order still saves', note.status === 200 && (await orderNow(o.id)).internalNote === 'customer changed their mind', note.json)
  const blank = await fulfil(M, o.id, { trackingCarrier: '  ', trackingNumber: '' })
  check('L1: blanks are not tracking — saved (200)', blank.status === 200, blank.json)
}
{
  // A value left from before the rule can be removed.
  const o = await mkOrder('cancelled', { trackingCarrier: 'UPS', trackingNumber: 'OLD-1' })
  const r = await fulfil(M, o.id, { trackingCarrier: '', trackingNumber: '' })
  const now = await orderNow(o.id)
  check('L1: tracking saved on a cancelled order before the rule can be cleared', r.status === 200 && !now.trackingCarrier && !now.trackingNumber, { r: r.json, now })
}
{
  const pending = await mkOrder('pending')
  const r = await fulfil(M, pending.id, { trackingNumber: 'P-1' })
  check('L1: an unpaid (pending) order takes no tracking either', r.status === 409 && r.json?.code === 'no_parcel' && !(await orderNow(pending.id)).trackingNumber, r.json)
  const neverLeft = await mkOrder('refunded', { fulfilledAt: null })
  const r2 = await fulfil(M, neverLeft.id, { trackingNumber: 'R-1' })
  check('L1: an order refunded before it went out takes none', r2.status === 409 && r2.json?.code === 'no_parcel', r2.json)
  const wentOut = await mkOrder('refunded', { fulfilledAt: new Date() })
  const r3 = await fulfil(M, wentOut.id, { trackingCarrier: 'USPS', trackingNumber: 'R-2' })
  check('L1: one refunded after it shipped keeps a parcel — tracking saves', r3.status === 200 && (await orderNow(wentOut.id)).trackingNumber === 'R-2', r3.json)
}
for (const status of ['paid', 'fulfilled', 'shipped', 'delivered']) {
  const o = await mkOrder(status, ['shipped', 'delivered', 'fulfilled'].includes(status) ? { fulfilledAt: new Date() } : {})
  const r = await fulfil(S, o.id, { trackingCarrier: 'USPS', trackingNumber: `T-${status}` })
  const now = await orderNow(o.id)
  check(`L1: a ${status} order takes tracking from the bench, status unchanged`, r.status === 200 && now.trackingNumber === `T-${status}` && now.status === status, r.json)
}
{
  // Decided from the status read: a cancel landing between the read and the write keeps the tracking off. A tracking
  // save that succeeds must have landed BEFORE the cancel — so the cancel's own answer (the row it wrote) carries it.
  // One landing after it, on the cancelled row, is exactly the T3 fault, and the final row alone cannot tell the two
  // apart.
  let clean = 0
  const rounds: unknown[] = []
  for (let i = 0; i < 6; i++) {
    const o = await mkOrder('paid')
    const [cancel, track] = await Promise.all([M('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'cancelled' }), fulfil(S, o.id, { trackingNumber: `RACE-${i}` })])
    const now = await orderNow(o.id)
    const ok = cancel.status === 200 && now.status === 'cancelled' && (
      track.status === 409
        ? !now.trackingNumber && /tracking was not saved|never went out/.test(track.json?.error)
        : track.status === 200 && cancel.json?.order?.trackingNumber === `RACE-${i}`)
    if (ok) clean++
    rounds.push({ cancel: cancel.status, track: track.status, cancelSaw: cancel.json?.order?.trackingNumber ?? null, final: now.trackingNumber })
  }
  check(`L1: tracking racing a cancel, six rounds: tracking is either refused (said so) or saved before the cancel — never written onto the cancelled order (${clean}/6)`, clean === 6, rounds)
  const quiet = await mkOrder('paid')
  await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, quiet.id))
  const late = await fulfil(S, quiet.id, { trackingNumber: 'LATE' })
  check('L1: a save from a page opened while the order was paid, after it was cancelled: refused', late.status === 409 && !(await orderNow(quiet.id)).trackingNumber, late.json)
}

// ── L1's sibling: no label for an order that cannot ship, with or without "mark shipped" ───────────
{
  const before = bought
  for (const status of ['cancelled', 'pending', 'refunded', 'delivered']) {
    const o = await mkOrder(status)
    const r = await S('POST', `/api/admin/shipping/orders/${o.id}/label`, { markShipped: false })
    const now = await orderNow(o.id)
    check(`labels: a ${status} order is sold no label even with markShipped: false (${r.status} ${r.json?.code})`, r.status === 409 && r.json?.code === 'no_parcel' && !now.labelUrl && !now.labelPurchasedAt && now.status === status, r.json)
    const m = await M('POST', `/api/admin/shipping/orders/${o.id}/label`, {})
    check(`labels: …nor to the manager with it (${status}, ${m.status})`, m.status === 409 && !(await orderNow(o.id)).labelUrl, m.json)
  }
  check(`labels: the carrier was never charged for any of them (${bought - before} labels bought)`, bought === before)
  const q0 = quoted
  const c = await mkOrder('cancelled')
  const rates = await S('GET', `/api/admin/shipping/orders/${c.id}/rates`)
  check('labels: a cancelled order is not quoted either', rates.status === 409 && rates.json?.code === 'no_parcel' && quoted === q0, rates.json)
}
{
  const o = await mkOrder('paid')
  const r = await S('POST', `/api/admin/shipping/orders/${o.id}/label`, { markShipped: false })
  const now = await orderNow(o.id)
  check('labels: a paid order still gets its label without being marked shipped', r.status === 200 && !!now.labelUrl && now.status === 'paid' && now.trackingNumber === r.json?.label?.trackingCode, r.json)
  const s = await mkOrder('paid')
  const r2 = await S('POST', `/api/admin/shipping/orders/${s.id}/label`, {})
  check('labels: …and with it, it ships', r2.status === 200 && (await orderNow(s.id)).status === 'shipped', r2.json)
  const rates = await S('GET', `/api/admin/shipping/orders/${(await mkOrder('fulfilled')).id}/rates`)
  check('labels: a fulfilled order is quoted', rates.status === 200 && Array.isArray(rates.json?.data), rates.json)
}

// ── the screens hold the same rule, and a seat that cannot save is shown no form to fill ─────────────
{
  const src = (p: string) => (require('node:fs') as typeof import('node:fs')).readFileSync(ROOT + 'apps/unified/' + p, 'utf8').replace(/\r\n/g, '\n') /* unified: the server and screens are apps/unified's */
  const server = src('server/crm/store/orders/rules.ts') /* unified: COUNTED and hasParcel are the orders group's rules.ts */
  const page = src('web/src/crm/pages/store/orders/OrderDetailPage.tsx') /* unified: the store add-on's order screen */
  const counted = (s: string) => s.match(/const COUNTED = \[([^\]]*)\]/)?.[1]
  check('screen: the order page\'s COUNTED is the server\'s', !!counted(page) && counted(page) === counted(server), { page: counted(page), server: counted(server) })
  const rule = (s: string) => s.match(/const hasParcel = \([^)]*\)[^=]*=>\s*([^\n]+)/)?.[1]?.replace(/\s+/g, ' ').trim()
  check('screen: hasParcel reads the same on both sides', !!rule(page) && rule(page) === rule(server), { page: rule(page), server: rule(server) })
  check('screen: the tracking boxes are shown under hasParcel (or while they hold something to clear)', /\{ships && \(hasParcel\(order\) \|\| order\.trackingCarrier \|\| order\.trackingNumber\) \? \(/.test(page)) /* unified: …on an order that is posted (ships): a pickup or gift-card-only order has no parcel to track (the store upgrade, 2026-10-24) */
  check('screen: the label panel names a closed order for what it is, before the permission line', page.indexOf('!canShip(order.status) ? (') > 0 && page.indexOf('!canShip(order.status) ? (') < page.indexOf(') : !mayBuy ? ('))
  const pay = src('web/src/crm/pages/store/orders/PaymentsPage.tsx') /* unified: the store add-on's Payments screen */
  check('screen: Payments renders its key form only for a seat that may connect', /\{mayConnect && \(\s*<div className="card p-5 space-y-4">/.test(pay) && !/disabled=\{[^}]*!mayConnect/.test(pay)) /* unified: the form is written `{mayConnect && (` on its own line */
  check('screen: …and Disconnect likewise', /\{mayConnect && <button onClick=\{disconnect\}/.test(pay))
  const css = src('web/src/index.css') /* unified: the app's one stylesheet */
  check('screen: a disabled field looks it — its own ground and ink, in both themes', /input:disabled,\s*select:disabled,\s*textarea:disabled \{\s*@apply cursor-not-allowed bg-gray-100 text-gray-600 dark:bg-slate-900 dark:text-slate-400;/.test(css))
  // T5 (staff): the dashboard's setup card told a seat Payments refuses to "Connect your payment account".
  const dash = src('web/src/crm/pages/store/orders/DashboardPage.tsx') /* unified: the store add-on's dashboard */
  check('screen (T5): a seat that cannot connect payments is never told to connect them — the payments step is the owner\'s alone',
    /\{mayConnectPayments && <ChecklistItem done=\{paymentsConnected\} to="\/crm\/payments"\s*text=\{paymentsConnected \? 'Payments connected' : 'Connect your payment account to accept orders'\} \/>\}/.test(dash) /* unified: the payment account is the owner's to read (ledger: "payments stay the owner's — reading the payment account too"), so another seat's dashboard cannot know whether it is connected and its checklist is the products alone — it no longer reads "The store owner connects them" (see the report) */
    && /\(!mayConnectPayments \|\| payment !== null\)/.test(dash) && /\(paymentsConnected \|\| !mayConnectPayments\)/.test(dash) /* unified: …and that seat's checklist is never held open waiting on a payment answer it is not given */
    && /\{mayConnectPayments \? 'Finish setting up your store' : 'Store setup'\}/.test(dash)
    && /mayAddProducts \? 'Add and activate your first product' : 'No products are live yet'/.test(dash))
  check('screen: Settings still turns the store form into a record for a seat without settings:update', /<fieldset disabled=\{!maySaveSettings\}/.test(src('web/src/crm/pages/store/catalog/StoreSettingsPage.tsx'))) /* unified: the store's settings screen is StoreSettingsPage (/crm/store-settings) */
}

globalThis.fetch = realFetch
console.log(`\nqa-t3 manager: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
