// crm-dispensary — T46 N3, N5 and N21: the public order-ahead menu.
//
// N3 (high)  Public delivery orders charged no delivery fee and took an address outside every zone.
//            An in-zone delivery came to $87.50 = $70 + tax with no $5 fee (ORD-MUM6CITF), and a
//            Chicago address was accepted by an Ohio shop at the same total (ORD-MUM6CIVU). The
//            register has charged the fee and enforced the minimum since T45 H7 — only the public
//            path skipped it, so the two are on one shared matcher now.
// N5 (high)  Public checkout had no age gate and asked for no date of birth: name, phone, email and
//            notes. Anyone at all could order cannabis; age was looked at only at the counter.
// N21 (med)  The Orders "Online" filter showed nothing although seven order-ahead orders existed —
//            they were typed pickup or delivery with no source — and their numbers (ORD-MUM6…) did
//            not follow the shop's ORD-14xx sequence.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, order } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-oa', email: 'oa@test.local', state: 'OH',
  taxRate: '8.0', exciseTaxRate: '10.0', purchaseLimitOz: '2.5',
  enabledFeatures: ['products', 'orders', 'order_ahead', 'delivery'],
} as any).returning()

const [owner] = await db.insert(user).values({
  email: 'owner-oa@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const [flower] = await db.insert(product).values({
  name: 'Blue Dream', companyId: co.id, category: 'flower', price: '35', weightGrams: '3.5',
  stockQuantity: 200, trackInventory: true, taxCategory: 'cannabis', active: true, visible: true, inStock: true,
} as any).returning()
const [tee] = await db.insert(product).values({
  name: 'Logo Tee', companyId: co.id, category: 'merch', price: '25',
  stockQuantity: 50, trackInventory: true, taxCategory: 'merchandise', active: true, visible: true, inStock: true,
} as any).returning()

// The shop delivers to two Columbus ZIPs, $5, $50 minimum — the zone the retest set up.
await db.execute(sql`
  INSERT INTO delivery_zones (id, company_id, name, zip_codes, delivery_fee, minimum_order, active, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'T46 Zone', '["43215","43220"]'::jsonb, '5', '50', true, NOW(), NOW())
`)

const app = new Hono()
app.route('/api/public/menu', (await import('./src/routes/menu.ts')).default)
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)

const publicPost = async (path: string, body: unknown) => {
  const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const publicGet = async (path: string) => {
  const res = await app.request(path)
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

const ADULT = '1985-04-02'
const basket = (items: any[]) => ({ items, customerName: 'Ada Customer', customerPhone: '555-0100' })

// ── N5: the age gate ────────────────────────────────────────────────────────────────────────────
{
  const noDob = await publicPost('/api/public/menu/order', { ...basket([{ productId: flower.id, quantity: 1 }]), orderType: 'pickup' })
  check('N5: a cannabis order with no date of birth is refused', noDob.status === 400 && noDob.json?.code === 'dob_required', { status: noDob.status, body: noDob.json })

  const minor = await publicPost('/api/public/menu/order', { ...basket([{ productId: flower.id, quantity: 1 }]), dateOfBirth: '2008-03-01', orderType: 'pickup' })
  check('N5: an 18-year-old is refused, not left for the counter', minor.status === 403 && minor.json?.code === 'under_age', { status: minor.status, body: minor.json })
  check('N5: …and told the age, not just "no"', /21/.test(String(minor.json?.error)), minor.json?.error)

  const nonsense = await publicPost('/api/public/menu/order', { ...basket([{ productId: flower.id, quantity: 1 }]), dateOfBirth: 'not-a-date', orderType: 'pickup' })
  check('N5: a date that is not a date is refused', nonsense.status === 400 && nonsense.json?.code === 'dob_invalid', nonsense.json)

  const adult = await publicPost('/api/public/menu/order', { ...basket([{ productId: flower.id, quantity: 1 }]), dateOfBirth: ADULT, orderType: 'pickup' })
  check('N5: an adult orders normally', adult.status === 201, { status: adult.status, body: adult.json })

  // A t-shirt is not age-restricted, and asking for a date of birth to sell one would be absurd.
  const merchOnly = await publicPost('/api/public/menu/order', { ...basket([{ productId: tee.id, quantity: 1 }]), customerPhone: '555-0177', orderType: 'pickup' })
  check('N5: a merch-only basket still needs no date of birth', merchOnly.status === 201, { status: merchOnly.status, body: merchOnly.json })

  // The date is kept, so the counter check starts from something rather than from nothing.
  const kept: any = await db.execute(sql`SELECT date_of_birth FROM contact WHERE phone = '555-0100' AND company_id = ${co.id} LIMIT 1`)
  const dob = ((kept as any).rows || kept)?.[0]?.date_of_birth
  check('N5: …and it is recorded on the customer for the ID check at collection', !!dob, { dob })

  const menu = await publicGet('/api/public/menu')
  const listed = ((menu.json?.menu || []) as any[]).flatMap((group: any) => group?.products || [])
  check('N5: the menu tells the page which products are regulated, so it knows when to ask',
    listed.some((p: any) => p?.isCannabis === true) && listed.some((p: any) => p?.isCannabis === false),
    listed.map((p: any) => ({ name: p?.name, isCannabis: p?.isCannabis })))
}

// ── N3: the delivery fee and the zone ───────────────────────────────────────────────────────────
{
  // Two eighths = $70, inside the zone, over the $50 minimum.
  const inZone = await publicPost('/api/public/menu/order', {
    ...basket([{ productId: flower.id, quantity: 2 }]), dateOfBirth: ADULT,
    orderType: 'delivery', deliveryAddress: '100 High St, Columbus, OH 43215',
  })
  check('N3: an in-zone delivery is accepted', inZone.status === 201, { status: inZone.status, body: inZone.json })
  check('N3: …and the $5 fee is charged', Number(inZone.json?.deliveryFee) === 5, inZone.json)
  const sub = Number(inZone.json?.subtotal), tax = Number(inZone.json?.totalTax), total = Number(inZone.json?.total)
  check('N3: …on top of the taxed total, as a service charge outside the tax base',
    Math.abs(total - (sub + tax + 5)) < 0.005, { subtotal: sub, tax, total })
  check('N3: …and it is $70 of goods, not the $87.50 the retest saw with no fee', sub === 70, { subtotal: sub })

  const outOfZone = await publicPost('/api/public/menu/order', {
    ...basket([{ productId: flower.id, quantity: 2 }]), dateOfBirth: ADULT,
    orderType: 'delivery', deliveryAddress: '233 S Wacker Dr, Chicago, IL 60606',
  })
  check('N3: a Chicago address is refused by an Ohio shop', outOfZone.status === 400 && outOfZone.json?.code === 'outside_delivery_area',
    { status: outOfZone.status, body: outOfZone.json })
  check('N3: …and the customer is told what to do instead', /collection|call the shop/i.test(String(outOfZone.json?.error)), outOfZone.json?.error)

  const belowMin = await publicPost('/api/public/menu/order', {
    ...basket([{ productId: flower.id, quantity: 1 }]), dateOfBirth: ADULT,
    orderType: 'delivery', deliveryAddress: '100 High St, Columbus, OH 43215',
  })
  check('N3: a $35 delivery is refused against the zone\'s $50 minimum',
    belowMin.status === 400 && belowMin.json?.code === 'below_delivery_minimum', { status: belowMin.status, body: belowMin.json })
  check('N3: …naming both figures', Number(belowMin.json?.minimum) === 50 && Number(belowMin.json?.subtotal) === 35, belowMin.json)

  const noAddress = await publicPost('/api/public/menu/order', {
    ...basket([{ productId: flower.id, quantity: 2 }]), dateOfBirth: ADULT, orderType: 'delivery',
  })
  check('N3: a delivery with no address is still refused', noAddress.status === 400, { status: noAddress.status })

  // The fee and the zone are stored, not just charged, so the delivery screen and the books agree.
  const stored: any = await db.execute(sql`
    SELECT delivery_fee, delivery_zone_id FROM orders WHERE company_id = ${co.id} AND type = 'delivery' ORDER BY created_at DESC LIMIT 1
  `)
  const row = ((stored as any).rows || stored)?.[0]
  check('N3: the order records the fee it charged', Number(row?.delivery_fee) === 5, row)
  check('N3: …and which zone took it', !!row?.delivery_zone_id, row)
}

// ── N21: where the order came from, and what it is called ───────────────────────────────────────
{
  const rows: any = await db.execute(sql`
    SELECT number, order_number, source, type FROM orders WHERE company_id = ${co.id} ORDER BY order_number ASC
  `)
  const list = ((rows as any).rows || rows) as any[]
  check('N21: every order-ahead order is marked as coming from online',
    list.length > 0 && list.every((o) => o.source === 'online'), list.map((o) => ({ number: o.number, source: o.source })))
  check('N21: …and numbered from the shop\'s own sequence, not a base-36 timestamp',
    list.every((o) => /^ORD-\d+$/.test(String(o.number))), list.map((o) => o.number))
  check('N21: …starting where the register\'s sequence starts', Number(list[0]?.order_number) === 1001, list[0])
  check('N21: …and running consecutively', list.every((o, i) => Number(o.order_number) === 1001 + i), list.map((o) => o.order_number))

  // The Orders list's own "Online" filter is what the retest found empty.
  const online = await asOwner('/api/orders?source=online')
  const found = online.json?.data || online.json || []
  check('N21: the Orders list\'s Online filter finds them', Array.isArray(found) && found.length === list.length,
    { status: online.status, got: Array.isArray(found) ? found.length : found, want: list.length })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
