// crm-dispensary — the six findings T43 filed and I deferred.
//
// They were written into the T43 brief as "known, do not re-file", which meant the tester stopped
// reporting them and they went quiet for two rounds. Two of them were not notes at all:
//
//   N4   Analytics counted the sale MIX over every order in the window, cancelled ones included, so
//        it said 12 medical sales on a day compliance said 4. A regulator's report and the owner's
//        dashboard must not be able to differ about the same day.
//   N5   Order lines written before the refund guard can carry refunded_quantity > quantity. The
//        product mix clamped per GROUP, so one such line went negative and ate into every good line
//        beside it: 7 days read 4 Shatter sold while that day alone was 11.
//   N6   The Kiosk screen says "ask an admin or the owner"; the API let a manager create and revoke.
//        And the audit log recorded a revoke as "Deleted kiosk device" for a row still standing.
//   N9   A partial settings save deleted every key already STORED as null, whether or not the save
//        mentioned it — 30 keys to 27, taking billingType and two billing dates with it. And a
//        timezone sent at the top level was silently dropped by the schema: 200, nothing changed,
//        the store still on the zone its state implies. That is wrong in IN, KY, TN and TX.
//   N11  The roster showed the raw hierarchy ids "field" and "user" at a shop that calls them
//        budtenders.
//   H2b  A refund entered by AMOUNT books back no units, so the category breakdown never saw it:
//        $10 came off ORD-1374 and flower still read its full $240.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Deferred Dispensary', slug: 'deferred', email: 'deferred@test.local',
  state: 'OH', settings: {},
  enabledFeatures: ['loyalty_rewards', 'orders', 'products', 'analytics', 'kiosk', 'compliance'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-deferred@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const manager = await mkUser('manager', 'manager')

const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()

const [flower] = await db.insert(product).values({
  name: 'Blue Dream', sku: 'BD-D', category: 'flower', price: '40', cost: '10',
  weightGrams: '3.5', stockQuantity: 500, trackInventory: true, taxCategory: 'cannabis', companyId: co.id,
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/orders', 'orders'],
  ['/api/analytics', 'analytics'],
  ['/api/company', 'company'],
  ['/api/kiosk', 'kiosk'],
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
  return { status: res.status, json: j }
}
const asOwner = as(owner), asAdmin = as(admin), asManager = as(manager)

const sell = async (qty: number) => {
  const r = await asOwner('POST', '/api/orders', {
    contactId: cust.id, items: [{ productId: flower.id, quantity: qty }],
    type: 'walk_in', idVerified: true, paymentMethod: 'cash',
  })
  if (r.status !== 201) { console.log('   sale failed:', r.status, JSON.stringify(r.json).slice(0, 200)); return null }
  await asOwner('POST', `/api/orders/${r.json.id}/complete`, { paymentMethod: 'cash', cashTendered: 100000 })
  return r.json
}

// ── N4: the mix counts sales, not tickets ──────────────────────────────────────────────────────
const settled = await sell(1)
check('setup: a sale settled', !!settled, settled?.number)
// …and a cancelled ticket for the same customer, which is not a sale.
const binned = await asOwner('POST', '/api/orders', {
  contactId: cust.id, items: [{ productId: flower.id, quantity: 1 }],
  type: 'walk_in', idVerified: true, paymentMethod: 'cash',
})
await asOwner('PUT', `/api/orders/${binned.json.id}/status`, { status: 'cancelled' })

const summary = await asOwner('GET', '/api/analytics/summary')
const s = summary.json?.orders || {}
check('N4: the cancelled ticket is not counted as a walk-in sale',
  Number(s?.walkInCount ?? s?.walk_in_count) === 1,
  { walkIn: s?.walkInCount ?? s?.walk_in_count, totalOrders: s?.totalOrders ?? s?.total_orders })
check('N4: ...while the order count still knows about both',
  Number(s?.totalOrders ?? s?.total_orders) === 2, s)

// ── N5: one over-refunded legacy line cannot drag a category negative ───────────────────────────
// Written straight to the table, which is the only way to make the shape that predates the guard.
const good = await sell(5)
const legacy = await sell(2)
await db.execute(sql`UPDATE order_items SET refunded_quantity = 9 WHERE order_id = ${legacy.id}`)
const mix = await asOwner('GET', '/api/analytics/products?period=1d')
const rows: any[] = mix.json?.data || mix.json?.productMix || (Array.isArray(mix.json) ? mix.json : [])
const flowerRow = rows.find((r: any) => (r.product_id || r.productId) === flower.id) || rows[0]
check('N5: the over-refunded line contributes nothing, not less than nothing',
  Number(flowerRow?.total_sold ?? flowerRow?.totalSold) === 6,
  { sold: flowerRow?.total_sold ?? flowerRow?.totalSold, expected: 6, note: '1 + 5 good units; the 2-unit line booked back 9 and is floored at 0' })
check('N5: ...and neither can it drag the revenue down', Number(flowerRow?.total_revenue ?? flowerRow?.totalRevenue) === 240,
  { revenue: flowerRow?.total_revenue ?? flowerRow?.totalRevenue, expected: 240 })

// ── H2b: an amount refund reaches the category breakdown ───────────────────────────────────────
const byAmount = await sell(6)                       // 6 × $40 = $240 of flower
const beforeCats = await asOwner('GET', '/api/analytics/summary')
const catsBefore: any[] = beforeCats.json?.salesByCategory || beforeCats.json?.categories || []
const flowerBefore = Number((catsBefore.find((r: any) => r.category === 'flower') || {}).revenue || 0)
check('H2b: setup — flower carries the goods value of every settled sale', flowerBefore > 0, flowerBefore)

const refund = await asOwner('POST', `/api/orders/${byAmount.id}/refund`, { amount: 10, reason: 'goodwill' })
check('H2b: a $10 refund by amount is accepted', refund.status === 200, { status: refund.status, body: refund.json })
const afterCats = await asOwner('GET', '/api/analytics/summary')
const catsAfter: any[] = afterCats.json?.salesByCategory || afterCats.json?.categories || []
const flowerAfter = Number((catsAfter.find((r: any) => r.category === 'flower') || {}).revenue || 0)
check('H2b: the category came down — it used to ignore an amount refund entirely',
  flowerAfter < flowerBefore, { before: flowerBefore, after: flowerAfter })
// The merchandise share only: the $10 carried tax, and the categories are pre-tax.
check('H2b: ...by the goods share of the refund, not the whole tax-inclusive $10',
  flowerBefore - flowerAfter > 0 && flowerBefore - flowerAfter < 10,
  { removed: flowerBefore - flowerAfter })

// ── N6: a kiosk is the admin's, and revoking is not deleting ────────────────────────────────────
const mgrKiosk = await asManager('POST', '/api/kiosk/devices', { name: 'Manager probe' })
check('N6: a manager cannot create a kiosk — the screen has said so since T42', mgrKiosk.status === 403, { status: mgrKiosk.status, body: mgrKiosk.json })
const adminKiosk = await asAdmin('POST', '/api/kiosk/devices', { name: 'Front door' })
check('N6: an admin can', adminKiosk.status === 201 || adminKiosk.status === 200, { status: adminKiosk.status, body: adminKiosk.json })
check('N6: a manager can still SEE the fleet they run the floor for',
  (await asManager('GET', '/api/kiosk/devices')).status === 200)

const deviceId = adminKiosk.json?.id || adminKiosk.json?.device?.id
if (deviceId) {
  const mgrRevoke = await asManager('POST', `/api/kiosk/devices/${deviceId}/revoke`, {})
  check('N6: a manager cannot revoke one either', mgrRevoke.status === 403, mgrRevoke.status)
  const adminRevoke = await asAdmin('POST', `/api/kiosk/devices/${deviceId}/revoke`, {})
  check('N6: an admin can', adminRevoke.status === 200, adminRevoke.status)
  const logged: any = await db.execute(sql`SELECT action FROM audit_log WHERE entity = 'kiosk_device' AND entity_id = ${deviceId} ORDER BY created_at DESC LIMIT 1`)
  const action = String(((logged as any).rows || logged)?.[0]?.action || '')
  check('N6: the audit log calls a revoke a status change, not a deletion — the row is still there',
    action === 'status_change', action)
}

// ── N9: settings ───────────────────────────────────────────────────────────────────────────────
await db.execute(sql`UPDATE company SET settings = '{"timezone":"America/Chicago","billingType":null,"nextBillingDate":null,"keepMe":"yes"}'::json WHERE id = ${co.id}`)
const save = await asOwner('PUT', '/api/company', { settings: { keepMe: 'still yes' } })
check('N9: an unrelated save succeeds', save.status === 200, { status: save.status, body: save.json })
const after: any = await db.execute(sql`SELECT settings FROM company WHERE id = ${co.id}`)
const stored = ((after as any).rows || after)?.[0]?.settings || {}
check('N9: keys stored as null survive a save that never mentioned them',
  'billingType' in stored && 'nextBillingDate' in stored,
  { keys: Object.keys(stored) })
check('N9: ...and the save that WAS asked for landed', stored.keepMe === 'still yes', stored.keepMe)
check('N9: ...and the timezone is untouched', stored.timezone === 'America/Chicago', stored.timezone)

const explicitRemove = await asOwner('PUT', '/api/company', { settings: { keepMe: null } })
check('N9: an explicit null still removes the key — that is how a caller says "take it out"',
  explicitRemove.status === 200, explicitRemove.status)
const after2: any = await db.execute(sql`SELECT settings FROM company WHERE id = ${co.id}`)
const stored2 = ((after2 as any).rows || after2)?.[0]?.settings || {}
check('N9: ...so keepMe is gone', !('keepMe' in stored2), Object.keys(stored2))
check('N9: ...and the null-valued keys are still not collateral', 'billingType' in stored2, Object.keys(stored2))

const topLevelTz = await asOwner('PUT', '/api/company', { timezone: 'America/Chicago' })
check('N9: a timezone sent at the top level is refused, not silently dropped',
  topLevelTz.status === 400 && topLevelTz.json?.code === 'SETTING_BELONGS_IN_SETTINGS', topLevelTz.json)
check('N9: ...and the refusal says where it belongs',
  /settings/.test(String(topLevelTz.json?.error)), topLevelTz.json?.error)
const badTz = await asOwner('PUT', '/api/company', { settings: { timezone: 'Mars/Base' } })
check('N9: a timezone this system does not know is refused', badTz.status === 400 && badTz.json?.code === 'BAD_TIME_ZONE', badTz.json)
const goodTz = await asOwner('PUT', '/api/company', { settings: { timezone: 'America/Denver' } })
check('N9: a real one is accepted', goodTz.status === 200, goodTz.status)
check('N9: ...and reads back as what the shop actually runs on', goodTz.json?.effectiveTimeZone === 'America/Denver', goodTz.json?.effectiveTimeZone)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
