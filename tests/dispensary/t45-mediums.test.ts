// crm-dispensary — the T45 mediums where the server accepted something it should not have, or fell
// over on something it should have handled.
//
//   M7   A product with sales history hard-deleted with a 204, while a CUSTOMER with history is
//        protected — the same rule applied to one side of the same order.
//   M8   The public kiosk menu ignored visible:false, listed a −$5 product, and showed a zero-stock
//        item as in stock.
//   M9   A licence expiring before it was issued, a duplicate licence number, and a licence expired
//        in 2025 listed "active" were all accepted. The issuing authority never appeared. No alert.
//   M11  POST /tracking/routes with an unknown driver gave 500.
//   M12  The payroll export gave 500. Shifts ending before they start, overlapping shifts for one
//        person, and 600-minute breaks were accepted.
//   M15  Duplicate equivalency rules for one category were accepted, so two conflicting factors
//        could both be live.
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
  name: 'Mediums Dispensary', slug: 'mediums', email: 'mediums@test.local', state: 'OH',
  purchaseLimitOz: '1',
  enabledFeatures: ['products', 'orders', 'compliance', 'kiosk', 'scheduling', 'delivery_tracking', 'equivalency'],
} as any).returning()

const mkUser = async (role: string, tag: string, extra: any = {}) => (await db.insert(user).values({
  email: `${tag}-med@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, ...extra,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const driver = await mkUser('driver', 'driver')

const app = new Hono()
for (const [mount, file] of [
  ['/api/products', 'products'],
  ['/api/compliance', 'compliance'],
  ['/api/kiosk', 'kiosk'],
  ['/api/scheduling', 'scheduling'],
  ['/api/tracking', 'tracking'],
  ['/api/equivalency', 'equivalency'],
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

// ── M7: a product that has been sold is part of the sales record ────────────────────────────────
const [sold] = await db.insert(product).values({
  name: 'Sold Kush', companyId: co.id, category: 'flower', price: '45', stockQuantity: 10,
  active: true, visible: true, trackInventory: true, weightGrams: '3.5',
} as any).returning()
const [unsold] = await db.insert(product).values({
  name: 'Never Sold', companyId: co.id, category: 'flower', price: '30', stockQuantity: 5,
  active: true, visible: true, trackInventory: true, weightGrams: '3.5',
} as any).returning()

const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()
const [ord] = await rows(sql`
  INSERT INTO orders(id, company_id, contact_id, status, payment_status, subtotal, total, completed_at, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, ${cust.id}, 'completed', 'paid', '45', '45', NOW(), NOW(), NOW())
  RETURNING id
`)
await db.execute(sql`
  INSERT INTO order_items(id, order_id, company_id, product_id, product_name, quantity, unit_price, line_total)
  VALUES (gen_random_uuid(), ${ord.id}, ${co.id}, ${sold.id}, 'Sold Kush', 1, '45', '45')
`)

const delSold = await asManager('DELETE', `/api/products/${sold.id}`)
check('M7: a product with sales history cannot be hard-deleted', delSold.status === 409, { status: delSold.status, body: delSold.json })
check('M7: ...and is told what to do instead', delSold.json?.code === 'product_has_history', delSold.json)
const stillThere = await rows(sql`SELECT id FROM products WHERE id = ${sold.id}`)
check('M7: ...and the product is still there', stillThere.length === 1, stillThere)

const delUnsold = await asManager('DELETE', `/api/products/${unsold.id}`)
check('M7: a product that has never been sold still deletes', delUnsold.status === 204, { status: delUnsold.status, body: delUnsold.json })

// ── M8: what a customer is offered at the kiosk ─────────────────────────────────────────────────
await db.insert(product).values([
  { name: 'Hidden Flower', companyId: co.id, category: 'flower', price: '40', stockQuantity: 10, active: true, visible: false, trackInventory: true, weightGrams: '3.5' },
  { name: 'Negative Price', companyId: co.id, category: 'merch', price: '-5', stockQuantity: 10, active: true, visible: true, trackInventory: true },
  { name: 'Out Of Stock', companyId: co.id, category: 'merch', price: '20', stockQuantity: 0, active: true, visible: true, trackInventory: true },
  { name: 'On The Menu', companyId: co.id, category: 'merch', price: '20', stockQuantity: 5, active: true, visible: true, trackInventory: true },
] as any)

const kioskMenu = await app.request('/api/kiosk/menu')
const kioskJson: any = await kioskMenu.json()
const names = (kioskJson?.data || []).map((p: any) => p.name)
check('M8: the kiosk menu loads', kioskMenu.status === 200, { status: kioskMenu.status })
check('M8: a product hidden from customers is not on it', !names.includes('Hidden Flower'), names)
check('M8: a product priced below zero is not on it', !names.includes('Negative Price'), names)
check('M8: a product with no stock is not on it', !names.includes('Out Of Stock'), names)
check('M8: ...and what IS for sale still is', names.includes('On The Menu'), names)
check('M8: the count matches what is listed', Number(kioskJson?.pagination?.total) === names.length, { total: kioskJson?.pagination?.total, listed: names.length })

// ── M9: licences ────────────────────────────────────────────────────────────────────────────────
const lic = await asManager('POST', '/api/compliance/licenses', {
  licenseType: 'dispensary', licenseNumber: 'OH-0001', issuedBy: 'Ohio Board of Pharmacy',
  issuedDate: '2026-01-01', expirationDate: '2027-01-01', state: 'OH',
})
check('M9: a licence is recorded', lic.status === 201, { status: lic.status, body: lic.json })
check('M9: ...and the issuing authority comes back, under the name the form uses',
  lic.json?.issuedBy === 'Ohio Board of Pharmacy', lic.json)

const backwards = await asManager('POST', '/api/compliance/licenses', {
  licenseType: 'cultivation', licenseNumber: 'OH-0002',
  issuedDate: '2027-01-01', expirationDate: '2026-01-01',
})
check('M9: an expiry before the issue date is refused', backwards.status === 400, { status: backwards.status, body: backwards.json })

const dupeLic = await asManager('POST', '/api/compliance/licenses', {
  licenseType: 'cultivation', licenseNumber: 'OH-0001',
})
check('M9: a duplicate licence number is refused', dupeLic.status === 409, { status: dupeLic.status, body: dupeLic.json })

// A licence that has already run out, recorded "active" the way the tester found it.
await db.execute(sql`
  INSERT INTO licenses(id, company_id, license_type, license_number, issued_date, expiration_date, status, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'processor', 'OH-EXPIRED', '2024-01-01', '2025-01-01', 'active', NOW(), NOW())
`)
const list = await asManager('GET', '/api/compliance/licenses')
const expiredRow = (list.json || []).find((l: any) => l.licenseNumber === 'OH-EXPIRED')
check('M9: a licence whose date has passed is not listed "active"', expiredRow?.status === 'expired', expiredRow)
check('M9: ...and says so plainly', expiredRow?.expired === true, expiredRow)
check('M9: ...while the stored value is still visible for anyone who needs it', expiredRow?.storedStatus === 'active', expiredRow)

// One expiring soon, which is the alert the page never had.
await db.execute(sql`
  INSERT INTO licenses(id, company_id, license_type, license_number, issued_date, expiration_date, status, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'transport', 'OH-SOON', '2026-01-01', ${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)}, 'active', NOW(), NOW())
`)
const expiring = await asManager('GET', '/api/compliance/licenses/expiring')
check('M9: the expiry alert exists', expiring.status === 200, { status: expiring.status, body: expiring.json })
check('M9: ...and names the one that is about to lapse',
  (expiring.json?.expiringSoon || []).some((l: any) => l.licenseNumber === 'OH-SOON'), expiring.json?.expiringSoon)
check('M9: ...and the one that already has',
  (expiring.json?.expired || []).some((l: any) => l.licenseNumber === 'OH-EXPIRED'), expiring.json?.expired)

// ── M11: planning a route ───────────────────────────────────────────────────────────────────────
const noDriver = await asManager('POST', '/api/tracking/routes', {
  driverId: 'no-such-driver', orderIds: [ord.id],
})
check('M11: an unknown driver is a plain refusal, not a 500', noDriver.status === 400, { status: noDriver.status, body: noDriver.json })
check('M11: ...and says which part is wrong', noDriver.json?.code === 'driver_not_found', noDriver.json)

const noDeliveries = await asManager('POST', '/api/tracking/routes', {
  driverId: driver.id, orderIds: [ord.id],
})
check('M11: a real driver with no delivery orders is refused cleanly', noDeliveries.status === 400, { status: noDeliveries.status, body: noDeliveries.json })

// A real delivery with coordinates: the route must actually plan.
await db.execute(sql`UPDATE contact SET address = '1 Main St', lat = '40.0', lng = '-83.0' WHERE id = ${cust.id}`)
const [deliveryOrder] = await rows(sql`
  INSERT INTO orders(id, company_id, contact_id, status, type, payment_status, subtotal, total, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, ${cust.id}, 'confirmed', 'delivery', 'paid', '45', '45', NOW(), NOW())
  RETURNING id
`)
const route = await asManager('POST', '/api/tracking/routes', {
  driverId: driver.id, orderIds: [deliveryOrder.id],
})
check('M11: a route with a real driver and a real delivery is planned', route.status === 201, { status: route.status, body: route.json })

// ── M12: the rota, and the payroll it feeds ─────────────────────────────────────────────────────
const backwardsShift = await asManager('POST', '/api/scheduling/shifts', {
  userId: manager.id, date: '2026-10-01', startTime: '17:00', endTime: '09:00',
})
check('M12: a shift ending before it starts is refused', backwardsShift.status === 400, { status: backwardsShift.status, body: backwardsShift.json })

const longBreak = await asManager('POST', '/api/scheduling/shifts', {
  userId: manager.id, date: '2026-10-01', startTime: '09:00', endTime: '17:00', breakMinutes: 600,
})
check('M12: a break longer than the shift is refused', longBreak.status === 400, { status: longBreak.status, body: longBreak.json })

const firstShift = await asManager('POST', '/api/scheduling/shifts', {
  userId: manager.id, date: '2026-10-01', startTime: '09:00', endTime: '17:00', breakMinutes: 30,
})
check('M12: an ordinary shift is accepted', firstShift.status === 201, { status: firstShift.status, body: firstShift.json })

const overlapping = await asManager('POST', '/api/scheduling/shifts', {
  userId: manager.id, date: '2026-10-01', startTime: '16:00', endTime: '20:00',
})
check('M12: a second shift overlapping the first is refused', overlapping.status === 400, { status: overlapping.status, body: overlapping.json })
check('M12: ...and names the clash', overlapping.json?.code === 'shift_overlaps', overlapping.json)

const backToBack = await asManager('POST', '/api/scheduling/shifts', {
  userId: manager.id, date: '2026-10-01', startTime: '17:00', endTime: '21:00',
})
check('M12: a shift that starts when the last one ends is fine', backToBack.status === 201, { status: backToBack.status, body: backToBack.json })

// Worked hours, stored as text the way the clock-out writes them.
await db.execute(sql`
  UPDATE shifts SET status = 'clocked_out', actual_hours = '10', overtime_hours = '2'
  WHERE company_id = ${co.id} AND date = '2026-10-01' AND start_time = '09:00'
`)
await db.execute(sql`UPDATE "user" SET hourly_rate = '20' WHERE id = ${manager.id}`)

const payroll = await asManager('GET', '/api/scheduling/payroll-export?startDate=2026-10-01&endDate=2026-10-01')
check('M12: the payroll export runs', payroll.status === 200, { status: payroll.status, body: payroll.json })
const line = (payroll.json?.data || [])[0]
check('M12: ...with the hours worked', Number(line?.total_hours ?? line?.totalHours) === 10, line)
check('M12: ...regular hours capped at 8 rather than dropped', Number(line?.regular_hours ?? line?.regularHours) === 8, line)
check('M12: ...and gross pay of 8×20 + 2×20×1.5 = 220', Number(line?.gross_pay ?? line?.grossPay) === 220, line)

// ── M15: one equivalency rule per category ──────────────────────────────────────────────────────
const rule = await asOwner('POST', '/api/equivalency/rules', {
  state: 'OH', category: 'concentrate', equivalencyGrams: 5,
})
check('M15: an equivalency rule is created', rule.status === 201, { status: rule.status, body: rule.json })

const dupeRule = await asOwner('POST', '/api/equivalency/rules', {
  state: 'OH', category: 'concentrate', equivalencyGrams: 9,
})
check('M15: a second rule for the same category is refused', dupeRule.status === 409, { status: dupeRule.status, body: dupeRule.json })
check('M15: ...and points at the one that already exists', dupeRule.json?.code === 'duplicate_equivalency_rule', dupeRule.json)

const otherCategory = await asOwner('POST', '/api/equivalency/rules', {
  state: 'OH', category: 'edible', equivalencyGrams: 0.1,
})
check('M15: a different category is still fine', otherCategory.status === 201, { status: otherCategory.status, body: otherCategory.json })

const otherState = await asOwner('POST', '/api/equivalency/rules', {
  state: 'MI', category: 'concentrate', equivalencyGrams: 5,
})
check('M15: the same category in another state is still fine', otherState.status === 201, { status: otherState.status, body: otherState.json })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
