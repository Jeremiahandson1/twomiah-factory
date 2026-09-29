// crm-dispensary — T46 N10, N11, N12, N13.
//
// N10  Waste treated units as grams. Destroying 3.5 g of OG Kush — a 3.5 g unit — took stock 23 → 19,
//      four units, 14 g, for 3.5 g in the bin. The refusal for 99,999 g read "Only 19 grams on hand"
//      where 19 was the package count and the shop held 66.5 g.
// N11  Receiving a transfer failed from the screen: it sent the line as `id` and the endpoint wants
//      `itemId`, so every receipt answered 400 and a transfer shipped in T46 is still in transit.
// N12  The Zones screen showed an active $5/$50 zone as "Inactive, fee $0.00, min $0.00" — it read
//      three field names the API has never returned — while the till refused orders under $50
//      against that same zone. The table carries two spellings of the minimum and the create wrote
//      one while the read took the other.
// N13  Lab results with Pesticides FAIL saved with an overall PASS, THC 150% was accepted, and the
//      batch stayed labTested:false, so results never reached the thing they were about.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-h', email: 'h@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'compliance', 'delivery', 'locations', 'wholesale', 'batches'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t46h@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

// 23 eighths — 80.5 g — exactly the shelf the retest destroyed from.
const [kush] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '45', stockQuantity: 23,
  weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
} as any).returning()
const [tee] = await db.insert(product).values({
  name: 'Logo Tee', companyId: co.id, category: 'merch', price: '25', stockQuantity: 50, trackInventory: true,
} as any).returning()

const app = new Hono()
app.route('/api/compliance', (await import('./src/routes/compliance.ts')).default)
app.route('/api/locations', (await import('./src/routes/locations.ts')).default)
app.route('/api/delivery', (await import('./src/routes/delivery.ts')).default)
app.route('/api/wholesale', (await import('./src/routes/wholesale.ts')).default)
app.route('/api/batches', (await import('./src/routes/batches.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner)
const asManager = as(manager)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const stockOf = async (id: string) => Number((await rows(sql`SELECT stock_quantity FROM products WHERE id = ${id}`))[0]?.stock_quantity)

// ═══════════════════════════════════════════════ N10 · grams are not units ══════════════════════
{
  check('N10: setup — 23 eighths, which is 80.5 g', (await stockOf(kush.id)) === 23)

  const over = await asManager('POST', '/api/compliance/waste', {
    productId: kush.id, wasteType: 'expired', reason: 'past date', quantity: 99999, unit: 'grams', witness: 'Sam Manager',
  })
  check('N10: destroying 99,999 g is still refused', over.status === 400 && over.json?.code === 'waste_over_stock', over.json)
  check('N10: …and the refusal counts in grams — 80.5, not "19 grams" from a package count',
    Number(over.json?.onHandGrams) === 80.5 && /80\.5 g on hand/.test(String(over.json?.error)), over.json)

  const destroy = await asManager('POST', '/api/compliance/waste', {
    productId: kush.id, wasteType: 'expired', reason: 'past date', quantity: 3.5, unit: 'grams', witness: 'Sam Manager',
  })
  check('N10: destroying 3.5 g is accepted', destroy.status === 201, { status: destroy.status, body: destroy.json })
  check('N10: …and takes ONE eighth off the shelf, not four', (await stockOf(kush.id)) === 22, await stockOf(kush.id))

  const seven = await asManager('POST', '/api/compliance/waste', {
    productId: kush.id, wasteType: 'expired', reason: 'past date', quantity: 7, unit: 'grams', witness: 'Sam Manager',
  })
  check('N10: 7 g is two eighths', seven.status === 201 && (await stockOf(kush.id)) === 20, { status: seven.status, stock: await stockOf(kush.id) })

  const partial = await asManager('POST', '/api/compliance/waste', {
    productId: kush.id, wasteType: 'expired', reason: 'spill', quantity: 1, unit: 'grams', witness: 'Sam Manager',
  })
  check('N10: 1 g of a 3.5 g unit is refused rather than rounded to a whole package',
    partial.status === 400 && partial.json?.code === 'waste_partial_unit', partial.json)
  check('N10: …and says what the unit is', /3\.5 g units/.test(String(partial.json?.error)), partial.json?.error)
  check('N10: …and nothing moved', (await stockOf(kush.id)) === 20, await stockOf(kush.id))

  // Counted goods are counted, not weighed.
  const merch = await asManager('POST', '/api/compliance/waste', {
    productId: tee.id, wasteType: 'damaged', reason: 'torn', quantity: 2, unit: 'units', witness: 'Sam Manager',
  })
  check('N10: a t-shirt destroyed in units still comes off in units', merch.status === 201 && (await stockOf(tee.id)) === 48,
    { status: merch.status, stock: await stockOf(tee.id) })

  // An ounce is 28.35 g — 8.1 eighths, not a whole number, so it is refused by name rather than
  // silently rounded. The conversion itself is what matters here.
  const anOunce = await asManager('POST', '/api/compliance/waste', {
    productId: kush.id, wasteType: 'expired', reason: 'past date', quantity: 1, unit: 'oz', witness: 'Sam Manager',
  })
  check('N10: an ounce is converted, not taken as one unit', anOunce.status === 400 && anOunce.json?.code === 'waste_partial_unit', anOunce.json)
}

// ═══════════════════════════════════════ N12 · the zone the screen shows ════════════════════════
{
  const created = await asManager('POST', '/api/delivery/zones', {
    name: 'T46 Zone', zipCodes: ['43215', '43220'], deliveryFee: 5, minimumOrder: 50, active: true,
  })
  check('N12: a zone is created', created.status === 201, { status: created.status, body: created.json })

  const list = await asOwner('GET', '/api/delivery/zones')
  const zone = (Array.isArray(list.json) ? list.json : list.json?.data || []).find((z: any) => z.name === 'T46 Zone')
  check('N12: the zone comes back', !!zone, list.json)
  check('N12: …ACTIVE, not "Inactive"', zone?.active === true, { active: zone?.active })
  check('N12: …with the $5 fee it was saved with', Number(zone?.deliveryFee) === 5, { deliveryFee: zone?.deliveryFee })
  check('N12: …and the $50 minimum the till enforces, not $0.00', Number(zone?.minimumOrder) === 50, { minimumOrder: zone?.minimumOrder })

  // Both spellings of the column hold the same figure, so the screen and the till cannot disagree.
  const [raw] = await rows(sql`SELECT minimum_order, min_order FROM delivery_zones WHERE id = ${zone.id}`)
  check('N12: …and both spellings of the minimum agree in the table',
    Number(raw?.minimum_order) === 50 && Number(raw?.min_order) === 50, raw)

  // A zone written the OLD way — the legacy column only — still reads correctly.
  const [legacy] = await rows(sql`
    INSERT INTO delivery_zones (id, company_id, name, zip_codes, delivery_fee, min_order, active, created_at, updated_at)
    VALUES (gen_random_uuid(), ${co.id}, 'T46 Legacy Zone', '["43004"]'::jsonb, '7', '25', true, NOW(), NOW())
    RETURNING id
  `)
  const list2 = await asOwner('GET', '/api/delivery/zones')
  const old = (Array.isArray(list2.json) ? list2.json : list2.json?.data || []).find((z: any) => z.id === legacy.id)
  check('N12: a zone stored under the older column name reads right too',
    Number(old?.deliveryFee) === 7 && Number(old?.minimumOrder) === 25, old)
}

// ═══════════════════════════════════════════ N11 · receiving a transfer ═════════════════════════
{
  const locA = await asOwner('POST', '/api/locations', { name: 'Store A', type: 'retail' })
  const locB = await asOwner('POST', '/api/locations', { name: 'Store B', type: 'retail' })
  check('N11: two locations exist', locA.status === 201 && locB.status === 201, { a: locA.status, b: locB.status })

  // Location stock is its own ledger, separate from the product's catalogue count — a shop moving
  // product between two rooms has to have put it in the first one. Ten eighths at Store A.
  await db.execute(sql`
    INSERT INTO product_locations (id, product_id, location_id, quantity, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${kush.id}, ${locA.json.id}, 10, ${co.id}, NOW(), NOW())
  `)

  const transfer = await asManager('POST', '/api/locations/transfers', {
    fromLocationId: locA.json.id, toLocationId: locB.json.id,
    items: [{ productId: kush.id, quantity: 3 }],
  })
  check('N11: a transfer is raised', transfer.status === 201, { status: transfer.status, body: transfer.json })

  const shipped = await asManager('PUT', `/api/locations/transfers/${transfer.json.id}/ship`, {})
  check('N11: it ships', shipped.status === 200, { status: shipped.status, body: shipped.json })

  // The list is where the screen gets its lines, and `id` is what it carries — exactly what the
  // screen used to forward, and exactly what the endpoint refused.
  const list = await asManager('GET', '/api/locations/transfers')
  const row = (list.json?.data || []).find((t: any) => t.id === transfer.json.id)
  check('N11: the list carries the transfer\'s lines', (row?.items || []).length === 1, row?.items)
  const line = row.items[0]
  check('N11: …and each line has an id for the receipt to name', !!line?.id, line)

  const received = await asManager('PUT', `/api/locations/transfers/${transfer.json.id}/receive`, {
    items: [{ itemId: line.id, receivedQuantity: 3 }],
  })
  check('N11: receiving works — this used to be 400 "items.0.itemId: Required"', received.status === 200,
    { status: received.status, body: received.json })

  const [after] = await rows(sql`SELECT status FROM inventory_transfers WHERE id = ${transfer.json.id}`)
  check('N11: …and the transfer is no longer stuck in transit', after?.status === 'received', after)
}

// ═══════════════════════════════════════════ N13 · lab results ══════════════════════════════════
{
  const [batch] = await rows(sql`
    INSERT INTO batches (id, batch_number, product_id, initial_quantity, current_quantity, status, lab_tested, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'T46-B-001', ${kush.id}, 40, 40, 'active', false, ${co.id}, NOW(), NOW())
    RETURNING id, batch_number
  `)

  const mkTest = async (sampleId: string) => {
    const r = await asManager('POST', '/api/wholesale/lab-tests', {
      batchId: batch.id, sampleId, labName: 'T46 Labs',
    })
    return r
  }

  // A pesticide failure is a failure, whatever the form says the overall result was.
  const t1 = await mkTest('T46-SMP-1')
  check('N13: a lab test is raised', t1.status === 201, { status: t1.status, body: t1.json })
  const failed = await asManager('PUT', `/api/wholesale/lab-tests/${t1.json.id}/results`, {
    thc: 22.5, cbd: 0.4, pesticides: 'fail', heavyMetals: 'pass', microbials: 'pass', overallResult: 'pass',
  })
  check('N13: results save', failed.status === 200, { status: failed.status, body: failed.json })
  check('N13: …and a Pesticides FAIL makes the overall result FAIL, whatever was sent',
    failed.json?.overallResult === 'fail' && failed.json?.status === 'failed', failed.json)
  check('N13: …naming the panel that failed', (failed.json?.failedPanels || []).includes('Pesticides'), failed.json?.failedPanels)

  const [quarantined] = await rows(sql`SELECT lab_tested, status, lab_test_id FROM batches WHERE id = ${batch.id}`)
  check('N13: …the batch is marked tested', quarantined?.lab_tested === true, quarantined)
  check('N13: …linked to the test that did it', quarantined?.lab_test_id === t1.json.id, quarantined)
  check('N13: …and quarantined rather than left on sale', quarantined?.status === 'quarantine', quarantined)

  // An impossible potency is refused rather than stored against the batch.
  const t2 = await mkTest('T46-SMP-2')
  const impossible = await asManager('PUT', `/api/wholesale/lab-tests/${t2.json.id}/results`, {
    thc: 150, pesticides: 'pass', overallResult: 'pass',
  })
  check('N13: THC 150% is refused', impossible.status === 400 && impossible.json?.code === 'impossible_potency', impossible.json)

  // A clean certificate marks the batch tested and carries its potency across.
  const [batch2] = await rows(sql`
    INSERT INTO batches (id, batch_number, product_id, initial_quantity, current_quantity, status, lab_tested, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'T46-B-002', ${kush.id}, 40, 40, 'active', false, ${co.id}, NOW(), NOW())
    RETURNING id
  `)
  const t3 = await asManager('POST', '/api/wholesale/lab-tests', { batchId: batch2.id, sampleId: 'T46-SMP-3', labName: 'T46 Labs' })
  const clean = await asManager('PUT', `/api/wholesale/lab-tests/${t3.json.id}/results`, {
    thc: 24.1, cbd: 0.3, pesticides: 'pass', heavyMetals: 'pass', microbials: 'pass', mycotoxins: 'pass',
    residualSolvents: 'pass', foreignMatter: 'pass', overallResult: 'pass',
  })
  check('N13: a clean certificate passes', clean.json?.overallResult === 'pass' && clean.json?.status === 'passed', clean.json)
  const [tested] = await rows(sql`SELECT lab_tested, status, thc_percent FROM batches WHERE id = ${batch2.id}`)
  check('N13: …the batch reads as lab tested', tested?.lab_tested === true, tested)
  check('N13: …stays active', tested?.status === 'active', tested)
  check('N13: …and carries the tested potency', Number(tested?.thc_percent) === 24.1, tested)

  // The batch detail screen reads it back, which is where the tester looked.
  const detail = await asOwner('GET', `/api/batches/${batch2.id}`)
  check('N13: the batch detail shows it as tested', detail.json?.labTested === true, { labTested: detail.json?.labTested })
  check('N13: …with its certificate attached', (detail.json?.labTests || []).length === 1, (detail.json?.labTests || []).length)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
