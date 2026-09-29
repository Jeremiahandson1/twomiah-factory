// crm-dispensary — the second batch of T45 mediums.
//
//   M10  Staff-created delivery orders dropped the address and the zone, added no delivery fee and
//        ignored the zone minimum, so nobody could deliver them and the shop charged nothing for
//        trying. The Active list showed raw ids, "Unknown" and "0 items" because there was nothing
//        on the order to show.
//   M18  Generating End of Day again for a day orphaned the first report, future dates were allowed,
//        and the order count differed from the dashboard's for the same day.
//   M24  /auth/me never carried the shop's timezone, so every screen rendering a timestamp used the
//        viewer's clock — and AnalyticsPage's own store-day fix had been reaching for a field that
//        was not there.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Batch Two Dispensary', slug: 'batchtwo', email: 'b2@test.local', state: 'OH',
  purchaseLimitOz: '1', taxRate: '8.75', exciseTaxRate: '10',
  settings: { timezone: 'America/Chicago' },
  enabledFeatures: ['products', 'orders', 'delivery', 'eod', 'cash'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-b2@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

const [tee] = await db.insert(product).values({
  name: 'Logo Tee', companyId: co.id, category: 'merch', price: '25', stockQuantity: 100,
  active: true, visible: true, trackInventory: true,
} as any).returning()

const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1980-01-01',
  address: '1 Main St', city: 'Columbus', state: 'OH', zip: '43004',
} as any).returning()
const [noAddress] = await db.insert(contact).values({
  type: 'customer', name: 'Bo Noaddress', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/orders', 'orders'],
  ['/api/eod', 'eod'],
  ['/api/auth', 'auth'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, text: t, json: j }
}
const asOwner = as(owner)
const asManager = as(manager)

const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ── M10: a staff delivery order ─────────────────────────────────────────────────────────────────
const [zone] = await rows(sql`
  INSERT INTO delivery_zones(id, company_id, name, zip_codes, delivery_fee, minimum_order, active, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'East Side', '["43004","43085"]'::jsonb, '5', '50', true, NOW(), NOW())
  RETURNING id, name
`)

const noAddr = await asManager('POST', '/api/orders', {
  contactId: noAddress.id, type: 'delivery', idVerified: true,
  items: [{ productId: tee.id, quantity: 3 }],
})
check('M10: a delivery with no address anywhere is refused', noAddr.status === 400, { status: noAddr.status, body: noAddr.json })
check('M10: ...and says what is missing', noAddr.json?.code === 'delivery_address_required', noAddr.json)

const belowMinimum = await asManager('POST', '/api/orders', {
  contactId: cust.id, type: 'delivery', idVerified: true,
  items: [{ productId: tee.id, quantity: 1 }],
})
check('M10: an order under the zone minimum is refused', belowMinimum.status === 400, { status: belowMinimum.status, body: belowMinimum.json })
check('M10: ...naming the minimum and the shortfall', belowMinimum.json?.code === 'below_delivery_minimum', belowMinimum.json)

// $75 of merch: over the $50 minimum, in the 43004 zone, so the $5 fee applies.
const delivered = await asManager('POST', '/api/orders', {
  contactId: cust.id, type: 'delivery', idVerified: true,
  items: [{ productId: tee.id, quantity: 3 }],
  deliveryNotes: 'Ring the bell',
})
check('M10: a delivery over the minimum is accepted', delivered.status === 201, { status: delivered.status, body: delivered.json })

const [storedOrder] = await rows(sql`
  SELECT delivery_address, delivery_zone_id, delivery_fee, delivery_notes, subtotal, total
  FROM orders WHERE id = ${delivered.json?.id}
`)
check('M10: ...and keeps the address it is going to',
  String(storedOrder?.delivery_address || '').includes('1 Main St'), storedOrder?.delivery_address)
check('M10: ...matched to the zone by its ZIP', storedOrder?.delivery_zone_id === zone.id,
  { got: storedOrder?.delivery_zone_id, want: zone.id })
check('M10: ...with the zone\'s fee charged', Number(storedOrder?.delivery_fee) === 5, storedOrder?.delivery_fee)
check('M10: ...and the note for the driver', storedOrder?.delivery_notes === 'Ring the bell', storedOrder?.delivery_notes)

// $75 + 8.75% sales tax on merch = $81.56, plus the $5 fee = $86.56.
check('M10: the fee is on the total the customer pays',
  Math.abs(Number(storedOrder?.total) - (75 + 6.5625 + 5)) < 0.02,
  { total: storedOrder?.total, subtotal: storedOrder?.subtotal })

const explicitAddress = await asManager('POST', '/api/orders', {
  contactId: cust.id, type: 'delivery', idVerified: true,
  items: [{ productId: tee.id, quantity: 3 }],
  deliveryAddress: '99 Far Road, Nowhere, OH 99999',
})
check('M10: an address typed on the order beats the one on file', explicitAddress.status === 201, { status: explicitAddress.status, body: explicitAddress.json })
const [farOrder] = await rows(sql`SELECT delivery_address, delivery_zone_id, delivery_fee FROM orders WHERE id = ${explicitAddress.json?.id}`)
check('M10: ...and a ZIP no zone covers is simply no zone and no fee',
  farOrder?.delivery_zone_id === null && Number(farOrder?.delivery_fee) === 0, farOrder)

const walkIn = await asManager('POST', '/api/orders', {
  contactId: cust.id, type: 'walk_in', idVerified: true,
  items: [{ productId: tee.id, quantity: 1 }],
})
check('M10: a walk-in is untouched by any of this', walkIn.status === 201, { status: walkIn.status, body: walkIn.json })
const [walkInRow] = await rows(sql`SELECT delivery_fee, delivery_address FROM orders WHERE id = ${walkIn.json?.id}`)
check('M10: ...with no fee and no address', Number(walkInRow?.delivery_fee || 0) === 0 && !walkInRow?.delivery_address, walkInRow)

// ── M18: End of Day ─────────────────────────────────────────────────────────────────────────────
// The store is on Chicago time, so "today" is the shop's today, not UTC's.
const storeToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })
  .format(new Date(Date.now() + 36 * 3600 * 1000))

const future = await asManager('POST', '/api/eod/generate', { date: tomorrow })
check('M18: End of Day cannot be run for a day that has not happened', future.status === 400, { status: future.status, body: future.json })
check('M18: ...and says so', future.json?.code === 'future_date', future.json)

const first = await asManager('POST', '/api/eod/generate', { date: storeToday })
check('M18: today generates', first.status === 200 || first.status === 201, { status: first.status, body: first.json })
const second = await asManager('POST', '/api/eod/generate', { date: storeToday })
check('M18: generating it again works too', second.status === 200 || second.status === 201, { status: second.status })

const reportRows = await rows(sql`SELECT id FROM eod_reports WHERE company_id = ${co.id} AND date = ${storeToday}::date`)
check('M18: ...and leaves exactly one report for the day, not two', reportRows.length === 1, reportRows)

// A fully refunded sale still happened, and "how many sales today" has one answer in this product.
await db.execute(sql`
  INSERT INTO orders(id, company_id, contact_id, status, type, payment_status, subtotal, total, refunded_amount, completed_at, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, ${cust.id}, 'refunded', 'walk_in', 'refunded', '20', '20', '20', NOW(), NOW(), NOW())
`)
const withRefund = await asManager('POST', '/api/eod/generate', { date: storeToday })
const settledCount = await rows(sql`
  SELECT COUNT(*)::int AS n FROM orders
  WHERE company_id = ${co.id}
    AND status IN ('completed', 'partially_refunded', 'refunded')
    AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') = ${storeToday}::date
`)
check('M18: the order count is the settled set, the same one every other surface reports',
  Number(withRefund.json?.totalOrders) === Number(settledCount[0]?.n),
  { eod: withRefund.json?.totalOrders, settled: settledCount[0]?.n })

// ── M24: the shop's clock reaches the screens ───────────────────────────────────────────────────
const me = await asManager('GET', '/api/auth/me')
check('M24: /auth/me answers', me.status === 200, { status: me.status })
check('M24: ...and carries the shop\'s timezone', me.json?.company?.timeZone === 'America/Chicago', me.json?.company?.timeZone)

// With no configured zone it falls back to the one the licensed state implies — the same rule the
// server buckets its own figures on.
await db.execute(sql`UPDATE company SET settings = '{}'::json WHERE id = ${co.id}`)
const meAgain = await asManager('GET', '/api/auth/me')
check('M24: ...falling back to the state\'s zone when none is set',
  meAgain.json?.company?.timeZone === 'America/New_York', meAgain.json?.company?.timeZone)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
