// crm-dispensary — T52 N5: the ID-check banner must not say "the kiosk" about a sale the kiosk
// never saw.
//
// An order that is not yet ID-checked shows the budtender the date of birth on it, so they can hold
// it against the card. The sentence read "The kiosk recorded 04/02/1990 as the date of birth" — on
// every order that carried one. Several doors write that column: the kiosk, the public order-ahead
// page, and the till (which is also where an offline sale lands when the device reconnects). The
// whole job of that sentence is to say how much to trust the number before the card comes out, and
// an unattended tablet, a form somebody filled in at home, and a colleague typing at the register
// are three different amounts of trust.
//
// Naming the door needs the order to KNOW the door, and that turned out to be the real hole: only
// the public menu ever set `source`. The till left it null and the kiosk left it null while putting
// 'kiosk' in `type`, so `?source=pos` and `?source=kiosk` on the orders list matched nothing at all
// and the banner had nothing to read but a guess.
//
// So this test is in two halves: the wording helper answers correctly for each shape, AND each real
// door actually writes the shape it claims. A label that reads the right column off rows nobody
// fills in is the same bug in a new place.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

// The screen's own helper, read from the template source rather than re-implemented here — a copy
// of the rule in the test is a second rule that will drift from the one that ships.
const FACTORY_ROOT = (() => {
  const r = process.env.FACTORY_ROOT
  if (!r) throw new Error('FACTORY_ROOT is not set — run this through tests/dispensary/harness/run.ts')
  return r.endsWith('/') ? r : r + '/'
})()
const { dobSourceLabel } = await import(
  'file:///' + (FACTORY_ROOT + 'templates/crm-dispensary/frontend/src/utils/order.ts').replace(/\\/g, '/')
)

// ══════════ half one: the wording ═══════════════════════════════════════════════════════════════
{
  check('a kiosk order says the kiosk', dobSourceLabel({ source: 'kiosk', type: 'kiosk' }) === 'The kiosk recorded',
    dobSourceLabel({ source: 'kiosk', type: 'kiosk' }))
  check('…and so does one identified only by its kiosk session, for rows written before `source` was set',
    dobSourceLabel({ kioskSessionId: 'sess_1' }) === 'The kiosk recorded', dobSourceLabel({ kioskSessionId: 'sess_1' }))

  check('an order-ahead sale does NOT say the kiosk — that was the finding',
    dobSourceLabel({ source: 'online', type: 'pickup' }) !== 'The kiosk recorded', dobSourceLabel({ source: 'online', type: 'pickup' }))
  check('…it says the customer gave it', dobSourceLabel({ source: 'online', type: 'pickup' }) === 'The customer gave',
    dobSourceLabel({ source: 'online', type: 'pickup' }))

  check('a till sale says the till', dobSourceLabel({ source: 'pos', type: 'walk_in' }) === 'The till recorded',
    dobSourceLabel({ source: 'pos', type: 'walk_in' }))

  check('an order that does not say claims nothing it cannot show',
    dobSourceLabel({ type: 'walk_in' }) === 'This order carries', dobSourceLabel({ type: 'walk_in' }))
  check('…and neither does a missing order', dobSourceLabel(null) === 'This order carries', dobSourceLabel(null))
}

// ══════════ half two: every door writes the door it came through ════════════════════════════════
await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Door Leaf', slug: 'leaf-n5', email: 'n5@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'contacts', 'kiosk', 'order_ahead'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-n5@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const [flower] = await db.insert(product).values({
  name: 'Door Kush', companyId: co.id, category: 'flower', price: '50', stockQuantity: 100,
  strainName: 'Blue Dream', strainType: 'hybrid', weightGrams: '3.5', taxCategory: 'cannabis',
  trackInventory: true, active: true, visible: true, inStock: true, thcPercent: '20',
} as any).returning()
const [ada] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Buyer', companyId: co.id, dateOfBirth: '1985-04-02', phone: '555-9001',
} as any).returning()

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/menu', (await import('./src/routes/menu.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown, auth = true) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { 'x-test-user': owner.id } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// The till.
{
  const made = await api('POST', '/api/orders', {
    type: 'walk_in', contactId: ada.id, customerDob: '1985-04-02',
    items: [{ productId: flower.id, quantity: 1 }],
  })
  check('the till takes an order', made.status === 200 || made.status === 201, { status: made.status, body: made.json })
  const id = (made.json?.data || made.json)?.id
  const [row] = await rows(sql`SELECT source, type, kiosk_session_id FROM orders WHERE id = ${id}`)
  check('…and records that it came through the till — it used to record nothing', row?.source === 'pos', row)
  check('…so the banner names the till, not the kiosk',
    dobSourceLabel({ source: row?.source, type: row?.type, kioskSessionId: row?.kiosk_session_id }) === 'The till recorded',
    row)
  const filtered = await api('GET', '/api/orders?source=pos')
  const list = filtered.json?.data || filtered.json || []
  check('…and ?source=pos on the orders list finds it, which it never could before',
    Array.isArray(list) && list.some((o: any) => o.id === id), { status: filtered.status, n: Array.isArray(list) ? list.length : list })
}

// The public order-ahead page — no session at all, a customer on their phone.
{
  const placed = await api('POST', `/api/menu/order?slug=${co.slug}`, {
    customerName: 'Ada Buyer', customerPhone: '555-9001', dateOfBirth: '1985-04-02',
    orderType: 'pickup', items: [{ productId: flower.id, quantity: 1 }],
  }, false)
  check('the public menu takes an order-ahead', placed.status === 200 || placed.status === 201, { status: placed.status, body: placed.json })
  // The public response deliberately withholds internals, so the row is read directly.
  const [row] = await rows(sql`SELECT id, source, type, kiosk_session_id FROM orders WHERE company_id = ${co.id} AND source = 'online' ORDER BY created_at DESC LIMIT 1`)
  check('…and records that it came from online', row?.source === 'online', row)
  check('…so the banner says the CUSTOMER gave the date of birth — the finding, exactly',
    dobSourceLabel({ source: row?.source, type: row?.type, kioskSessionId: row?.kiosk_session_id }) === 'The customer gave',
    row)
}

// The kiosk. Its route needs a paired device, which this suite has no fixture for, so the row is
// written the way routes/kiosk.ts writes it and the columns the banner reads are checked from that.
// The SHAPE is what is being pinned here; guard #175 pins that kiosk.ts still writes it.
{
  await rows(sql`
    INSERT INTO orders (id, order_number, number, type, status, source, subtotal, total, customer_dob, kiosk_session_id, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 9001, 'ORD-9001', 'kiosk', 'pending', 'kiosk', '50', '50', '1985-04-02', 'sess-n5', ${co.id}, NOW(), NOW())
  `)
  const [row] = await rows(sql`SELECT source, type, kiosk_session_id FROM orders WHERE number = 'ORD-9001' AND company_id = ${co.id}`)
  check('a kiosk order says the kiosk in BOTH the column the filter reads and the session it was taken in',
    row?.source === 'kiosk' && !!row?.kiosk_session_id, row)
  check('…and the banner names it', dobSourceLabel({ source: row?.source, type: row?.type, kioskSessionId: row?.kiosk_session_id }) === 'The kiosk recorded', row)

  const filtered = await api('GET', '/api/orders?source=kiosk')
  const list = filtered.json?.data || filtered.json || []
  check('…and ?source=kiosk finds it', Array.isArray(list) && list.some((o: any) => o.number === 'ORD-9001'),
    { status: filtered.status, n: Array.isArray(list) ? list.length : list })
}

// The three doors must not answer alike — the bug was one sentence for all of them.
{
  const said = new Set([
    dobSourceLabel({ source: 'pos', type: 'walk_in' }),
    dobSourceLabel({ source: 'online', type: 'pickup' }),
    dobSourceLabel({ source: 'kiosk', type: 'kiosk', kioskSessionId: 's' }),
  ])
  check('the three doors say three different things', said.size === 3, [...said])
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
