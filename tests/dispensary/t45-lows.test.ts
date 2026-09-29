// crm-dispensary — the T45 lows that have server behaviour to hold.
//
//   L1   Validation messages named nothing — "One of the values is not in a valid format" told a
//        person nothing about which of twelve fields to look at.
//   L3   Receiving a purchase order did not update the product's cost ($18 stayed after receiving
//        at $12), so every margin figure downstream was computed against a price the shop stopped
//        paying.
//   L4   Unusable rewards could be created (150% off, free item with no product); redemption then
//        refused them at the counter rather than at the desk where they were typed.
//   L6   The same location could be added to a store group twice.
//   L7   A print run of 100,000 labels was accepted.
//   L8   Thirty wrong API keys in a row all answered 401 with nothing slowing them down.
//   L9   The ID-scan log listed a dash for every name.
//   L10  MFA devices showed "Pending" while the API had them verified.
//   L11  Analytics money came back at full numeric scale ("617.00000000000000000000").
//   L12  The wholesale stock refusal named a raw product id.
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
  name: 'Lows Dispensary', slug: 'lows', email: 'lows@test.local', state: 'OH',
  enabledFeatures: [
    'products', 'orders', 'purchase_orders', 'wholesale', 'id_verification', 'loyalty_rewards',
    'multi_location', 'multi_store', 'labels', 'analytics', 'security', 'integrations',
  ],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-lows@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

const [kush] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '45', costPrice: '18',
  stockQuantity: 5, active: true, visible: true, trackInventory: true, sku: 'SKU-KUSH',
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/purchase-orders', 'purchase-orders'],
  ['/api/loyalty', 'loyalty'],
  ['/api/enterprise', 'enterprise'],
  ['/api/labels', 'labels'],
  ['/api/id-scanner', 'id-scanner'],
  ['/api/security', 'security'],
  ['/api/integrations', 'integrations'],
  ['/api/wholesale', 'wholesale'],
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

// ── L3: receiving sets the cost the shop actually paid ──────────────────────────────────────────
const po = await asManager('POST', '/api/purchase-orders', {
  supplierName: 'Green Supply', items: [{ productId: kush.id, quantity: 10, unitCost: 12 }],
})
check('L3: a purchase order is raised', po.status === 201, { status: po.status, body: po.json })

const before = await rows(sql`SELECT cost_price, stock_quantity FROM products WHERE id = ${kush.id}`)
check('L3: setup — the product still costs what it did', Number(before[0]?.cost_price) === 18, before[0])

await asManager('PUT', `/api/purchase-orders/${po.json?.id}/submit`, {}).catch(() => {})
const received = await asManager('PUT', `/api/purchase-orders/${po.json?.id}/receive`, {
  items: [{ itemIndex: 0, receivedQty: 10 }],
})
check('L3: it can be received', received.status === 200, { status: received.status, body: received.json })

const after = await rows(sql`SELECT cost_price, stock_quantity FROM products WHERE id = ${kush.id}`)
check('L3: stock went up by what arrived', Number(after[0]?.stock_quantity) === 15, after[0])
check('L3: ...and the cost is what this delivery cost, not what the last one did',
  Number(after[0]?.cost_price) === 12, after[0])

// ── L4: a reward that cannot be redeemed cannot be created ──────────────────────────────────────
const overHundred = await asManager('POST', '/api/loyalty/rewards', {
  name: 'Too much off', pointsCost: 100, discountType: 'percent', discountValue: 150,
})
check('L4: a 150% discount is refused', overHundred.status === 400, { status: overHundred.status, body: overHundred.json })

const freeNothing = await asManager('POST', '/api/loyalty/rewards', {
  name: 'Free something', pointsCost: 100, discountType: 'free_item', discountValue: 0,
})
check('L4: a free-item reward with no product is refused', freeNothing.status === 400, { status: freeNothing.status, body: freeNothing.json })

const freeOther = await asManager('POST', '/api/loyalty/rewards', {
  name: 'Free other shop\'s thing', pointsCost: 100, discountType: 'free_item', discountValue: 0,
  productId: 'not-ours',
})
check('L4: ...and one naming a product that is not yours', freeOther.status === 400, { status: freeOther.status, body: freeOther.json })

const zeroOff = await asManager('POST', '/api/loyalty/rewards', {
  name: 'Nothing off', pointsCost: 100, discountType: 'fixed', discountValue: 0,
})
check('L4: a $0 money-off reward is refused', zeroOff.status === 400, { status: zeroOff.status, body: zeroOff.json })

const good = await asManager('POST', '/api/loyalty/rewards', {
  name: '10% off', pointsCost: 100, discountType: 'percent', discountValue: 10,
})
check('L4: a usable reward still saves', good.status === 201, { status: good.status, body: good.json })

const freeReal = await asManager('POST', '/api/loyalty/rewards', {
  name: 'Free pre-roll', pointsCost: 500, discountType: 'free_item', discountValue: 0, productId: kush.id,
})
check('L4: ...and so does a free item that names a real product', freeReal.status === 201, { status: freeReal.status, body: freeReal.json })

// ── L6: one location, once, per store group ─────────────────────────────────────────────────────
const [loc] = await rows(sql`
  INSERT INTO locations(id, company_id, name, type, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'Main Shop', 'dispensary', NOW(), NOW())
  RETURNING id
`)
const group = await asOwner('POST', '/api/enterprise/store-groups', { name: 'Ohio Chain', type: 'chain' })
check('L6: a store group is created', group.status === 201, { status: group.status, body: group.json })

const added = await asOwner('POST', `/api/enterprise/store-groups/${group.json?.id}/members`, { locationId: loc.id })
check('L6: a location joins it', added.status === 201 || added.status === 200, { status: added.status, body: added.json })

const addedAgain = await asOwner('POST', `/api/enterprise/store-groups/${group.json?.id}/members`, { locationId: loc.id, role: 'flagship' })
check('L6: adding it again is accepted as an edit, not a second row', addedAgain.status === 201 || addedAgain.status === 200,
  { status: addedAgain.status, body: addedAgain.json })
const members = await rows(sql`SELECT id, role FROM store_group_members WHERE group_id = ${group.json?.id} AND location_id = ${loc.id}`)
check('L6: ...so the group holds it once', members.length === 1, members)
check('L6: ...with the new role', members[0]?.role === 'flagship', members[0])

const foreignLoc = await asOwner('POST', `/api/enterprise/store-groups/${group.json?.id}/members`, { locationId: 'not-ours' })
check('L6: a location that is not yours cannot be added', foreignLoc.status === 404, { status: foreignLoc.status, body: foreignLoc.json })

// ── L7: a print run has a ceiling ───────────────────────────────────────────────────────────────
const [template] = await rows(sql`
  INSERT INTO label_templates(id, company_id, name, type, fields, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'Standard', 'product', '[]'::jsonb, NOW(), NOW())
  RETURNING id
`)
const hugeRun = await asManager('POST', '/api/labels/print', {
  templateId: template.id, productId: kush.id, quantity: 100000,
})
check('L7: a print run of 100,000 labels is refused', hugeRun.status === 400, { status: hugeRun.status, body: hugeRun.json })

const sensibleRun = await asManager('POST', '/api/labels/print', {
  templateId: template.id, productId: kush.id, quantity: 50,
})
check('L7: an ordinary run is accepted', sensibleRun.status === 201 || sensibleRun.status === 200,
  { status: sensibleRun.status, body: sensibleRun.json })

// ── L9: the ID-scan log has names in it ─────────────────────────────────────────────────────────
await asManager('POST', '/api/id-scanner/scan', {
  scanMethod: 'manual', name: 'Ada Customer', dateOfBirth: '1980-01-01', idNumber: 'OH-123456',
})
const scans = await asManager('GET', '/api/id-scanner/scans')
const firstScan = (scans.json?.data || [])[0]
check('L9: the scan log lists the name, not a dash', firstScan?.name === 'Ada Customer', firstScan)
check('L9: ...and the halves too, in the shape a screen reads', firstScan?.firstName === 'Ada' && firstScan?.lastName === 'Customer', firstScan)

// ── L10: a verified second factor is not "Pending" ──────────────────────────────────────────────
await db.execute(sql`
  INSERT INTO mfa_devices(id, user_id, company_id, type, name, is_verified, created_at)
  VALUES (gen_random_uuid(), ${manager.id}, ${co.id}, 'totp', 'Work Phone', true, NOW())
`)
const devices = await asManager('GET', '/api/security/mfa/devices')
const device = (Array.isArray(devices.json) ? devices.json : [])[0]
check('L10: a verified device reports as verified', device?.verified === true, device)
check('L10: ...under the name the screen reads', device?.name === 'Work Phone', device)

// ── L8: a wall of wrong keys gets slowed down ───────────────────────────────────────────────────
let sawRateLimit = false
let lastStatus = 0
for (let i = 0; i < 15; i++) {
  const res = await app.request('/api/integrations/inventory-sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': `wrong-${i}`, 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ items: [] }),
  })
  lastStatus = res.status
  if (res.status === 429) { sawRateLimit = true; break }
}
check('L8: a run of wrong keys is eventually refused outright', sawRateLimit, { lastStatus })

// A different address is unaffected — one bad actor must not lock out an integrator.
const otherAddress = await app.request('/api/integrations/inventory-sync', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-API-Key': 'also-wrong', 'x-forwarded-for': '198.51.100.4' },
  body: JSON.stringify({ items: [] }),
})
check('L8: ...and another caller is untouched by it', otherAddress.status === 401, { status: otherAddress.status })

// ── L12: the stock refusal names the product ────────────────────────────────────────────────────
const buyer = await asManager('POST', '/api/wholesale/customers', {
  name: 'Green Valley', licenseNumber: 'C10-9999',
})
const wholesaleOrder = await asManager('POST', '/api/wholesale/orders', {
  customerId: buyer.json?.id,
  items: [{ productId: kush.id, quantity: 9999, unitPrice: 20 }],
})
if (wholesaleOrder.status === 201) {
  await asManager('PUT', `/api/wholesale/orders/${wholesaleOrder.json?.id}/confirm`, {}).catch(() => {})
  const ship = await asManager('PUT', `/api/wholesale/orders/${wholesaleOrder.json?.id}/ship`, { manifestNumber: 'M-1' })
  check('L12: shipping more than is on hand is refused', ship.status === 400, { status: ship.status, body: ship.json })
  check('L12: ...naming the product, not its database id',
    String(ship.json?.error || '').includes('OG Kush') && !String(ship.json?.error || '').includes(kush.id),
    ship.json)
} else {
  check('L12: a wholesale order for more than is on hand is set up', false, { status: wholesaleOrder.status, body: wholesaleOrder.json })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
