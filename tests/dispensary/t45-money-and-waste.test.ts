// crm-dispensary — the three T45 highs that make the shop's own numbers wrong.
//
//   H15  Logging destroyed product did not reduce stock (OG Kush 23 → 23 after 3.5 g), accepted
//        99,999 g from a product holding 23, accepted no witness at all, and accepted waste booked
//        against another product's batch.
//   H16  The excise filing's taxable amount was every sale's gross subtotal — T-shirts included,
//        before a single refund — beside a tax due that is net and cannabis-only. The state was
//        blank on a return whose purpose is to name it, for a shop whose record says OH.
//   H18  With five drawers open in a day, End of Day reported one of them: $103.75 expected against
//        $103.75 counted and a variance of zero, while the day was $10 short.
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
  name: 'Money Dispensary', slug: 'money', email: 'money@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'compliance', 'batches', 'eod', 'cash', 'tax_filing'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-money@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

const [kush] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '45', stockQuantity: 23,
} as any).returning()
const [tee] = await db.insert(product).values({
  name: 'Logo Tee', companyId: co.id, category: 'merch', price: '25', stockQuantity: 50,
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/compliance', 'compliance'],
  ['/api/eod', 'eod'],
  ['/api/tax-filing', 'tax-filing'],
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
const asManager = as(manager)
const asOwner = as(owner)

const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const stockOf = async (id: string) => Number((await rows(sql`SELECT stock_quantity FROM products WHERE id = ${id}`))[0]?.stock_quantity)

// ── H15: destroying product is an inventory movement ────────────────────────────────────────────
const [kushBatch] = await rows(sql`
  INSERT INTO batches(id, batch_number, product_id, initial_quantity, current_quantity, unit_of_measure, status, company_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'W-KUSH-1', ${kush.id}, 23, 23, 'grams', 'active', ${co.id}, NOW(), NOW())
  RETURNING id, batch_number
`)
const [teeBatch] = await rows(sql`
  INSERT INTO batches(id, batch_number, product_id, initial_quantity, current_quantity, unit_of_measure, status, company_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'W-TEE-1', ${tee.id}, 50, 50, 'units', 'active', ${co.id}, NOW(), NOW())
  RETURNING id, batch_number
`)

const noWitness = await asManager('POST', '/api/compliance/waste', {
  productId: kush.id, wasteType: 'expired', reason: 'past date', quantity: 1, unit: 'grams',
})
check('H15: waste with no witness is refused', noWitness.status === 400, { status: noWitness.status, body: noWitness.json })
check('H15: ...and says what is missing', noWitness.json?.code === 'witness_required', noWitness.json)

const overStock = await asManager('POST', '/api/compliance/waste', {
  productId: kush.id, wasteType: 'expired', reason: 'past date', quantity: 99999, unit: 'grams', witness: 'Sam Manager',
})
check('H15: destroying more than is on hand is refused', overStock.status === 400, { status: overStock.status, body: overStock.json })
check('H15: ...by name', overStock.json?.code === 'waste_over_stock', overStock.json)

const wrongBatch = await asManager('POST', '/api/compliance/waste', {
  productId: kush.id, batchNumber: 'W-TEE-1', wasteType: 'expired', reason: 'past date',
  quantity: 1, unit: 'grams', witness: 'Sam Manager',
})
check('H15: waste booked against another product\'s batch is refused', wrongBatch.status === 400, { status: wrongBatch.status, body: wrongBatch.json })
check('H15: ...by name', wrongBatch.json?.code === 'batch_product_mismatch', wrongBatch.json)

check('H15: setup — 23 on hand before the destruction', (await stockOf(kush.id)) === 23)

const waste = await asManager('POST', '/api/compliance/waste', {
  productId: kush.id, batchNumber: 'W-KUSH-1', wasteType: 'expired', reason: 'past date',
  quantity: 3, unit: 'grams', witness: 'Sam Manager', notes: 'binned',
})
check('H15: a complete waste entry is recorded', waste.status === 201, { status: waste.status, body: waste.json })
check('H15: ...and stock came down by what was destroyed', (await stockOf(kush.id)) === 20, await stockOf(kush.id))
const batchAfter = await rows(sql`SELECT current_quantity FROM batches WHERE id = ${kushBatch.id}`)
check('H15: ...and so did the batch it came out of', Number(batchAfter[0]?.current_quantity) === 20, batchAfter[0])
check('H15: ...and the response says where stock landed', waste.json?.stockAfter === 20, waste.json?.stockAfter)

// ── H18: a day with several drawers ─────────────────────────────────────────────────────────────
// The STORE's today (this shop is in Ohio), not UTC's. End of Day refuses a day that has not
// happened yet on the shop's clock, and for five hours a night the two calendars disagree.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
// Pinned to clock times ON the report date rather than "N minutes ago": run this shortly after
// UTC midnight and "ten hours ago" is yesterday, so EOD finds no drawers and the assertions read
// as a regression that is really the clock.
const mkSession = async (opening: number, expected: number, counted: number, hour: number) => {
  const at = (h: number) => `${today}T${String(h).padStart(2, '0')}:00:00.000Z`
  const opened = at(hour)
  const closed = at(hour + 1)
  await db.execute(sql`
    INSERT INTO cash_sessions(id, company_id, user_id, opened_at, closed_at, opening_amount, expected_amount,
                              actual_count, closing_amount, variance, status, created_at)
    VALUES (gen_random_uuid(), ${co.id}, ${manager.id}, ${opened}::timestamp, ${closed}::timestamp,
            ${String(opening)}, ${String(expected)}, ${String(counted)}, ${String(counted)},
            ${String(Math.round((counted - expected) * 100) / 100)}, 'closed', NOW())
  `)
}
// Five drawers: $1,191.25 expected, $1,181.25 counted — $10 short, all of it in the third.
await mkSession(200, 250.50, 250.50, 8)
await mkSession(200, 312.00, 312.00, 10)
await mkSession(200, 325.00, 315.00, 12)
await mkSession(200, 200.00, 200.00, 14)
await mkSession(200, 103.75, 103.75, 16)

const eod = await asManager('POST', '/api/eod/generate', { date: today })
check('H18: End of Day generates', eod.status === 200 || eod.status === 201, { status: eod.status, body: eod.json })
check('H18: it counts every drawer opened today, not the last one', eod.json?.drawerCount === 5, eod.json?.drawerCount)
check('H18: expected is the day, not one drawer', Number(eod.json?.cashExpected) === 1191.25, eod.json?.cashExpected)
check('H18: counted is the day', Number(eod.json?.cashActual) === 1181.25, eod.json?.cashActual)
check('H18: and the $10 shortage is on the report', Number(eod.json?.cashVariance) === -10, eod.json?.cashVariance)
const shortDrawer = (eod.json?.drawers || []).filter((d: any) => Number(d.variance) !== 0)
check('H18: the breakdown names which drawer is short', shortDrawer.length === 1 && Number(shortDrawer[0].variance) === -10, shortDrawer)

// ── H16: the excise filing's taxable amount ─────────────────────────────────────────────────────
const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()

// One sale: $100 of cannabis + $25 of merch. Excise is charged on the cannabis only.
const [ord] = await rows(sql`
  INSERT INTO orders(id, company_id, contact_id, status, payment_status, payment_method, subtotal,
                     excise_tax, sales_tax, total_tax, total, refunded_amount, refunded_tax,
                     refunded_excise_tax, refunded_sales_tax, completed_at, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, ${cust.id}, 'completed', 'paid', 'cash', '125',
          '10', '8.75', '18.75', '143.75', '0', '0', '0', '0', NOW(), NOW(), NOW())
  RETURNING id
`)
await db.execute(sql`
  INSERT INTO order_items(id, order_id, company_id, product_id, product_name, quantity, refunded_quantity,
                          unit_price, total_price, line_total, category, tax_category)
  VALUES (gen_random_uuid(), ${ord.id}, ${co.id}, ${kush.id}, 'OG Kush', 2, 0, '50', '100', '100', 'flower', 'cannabis'),
         (gen_random_uuid(), ${ord.id}, ${co.id}, ${tee.id}, 'Logo Tee', 1, 0, '25', '25', '25', 'merch', 'non_cannabis')
`)

// A tax filing's period is bounded on the raw completed_at timestamps, not on the store's
// calendar — so this window is written in UTC, which is what NOW() above wrote. (End of Day, just
// up the file, is the opposite: it buckets by the SHOP's day and needs the shop's date.)
const utcToday = new Date().toISOString().split('T')[0]
const period = { periodStart: `${utcToday}T00:00:00.000Z`, periodEnd: utcToday }
const excise = await asOwner('POST', '/api/tax-filing/filings/generate', { filingType: 'excise_tax', ...period })
check('H16: an excise filing is created', excise.status === 201 || excise.status === 200, { status: excise.status, body: excise.json })
check('H16: it is stamped with the shop\'s own state, not "NA"',
  String(excise.json?.state || excise.json?.filingNumber || '').includes('OH'),
  { state: excise.json?.state, filingNumber: excise.json?.filingNumber })
check('H16: the taxable amount is the cannabis, not the T-shirt beside it',
  Number(excise.json?.total_taxable_amount ?? excise.json?.totalTaxableAmount) === 100,
  { got: excise.json?.total_taxable_amount ?? excise.json?.totalTaxableAmount })

const sales = await asOwner('POST', '/api/tax-filing/filings/generate', { filingType: 'sales_tax', ...period })
check('H16: a sales-tax filing is charged on everything sold',
  Number(sales.json?.total_taxable_amount ?? sales.json?.totalTaxableAmount) === 125,
  { got: sales.json?.total_taxable_amount ?? sales.json?.totalTaxableAmount })

// Hand back one unit of the cannabis line: the taxable amount must follow it down.
await db.execute(sql`UPDATE order_items SET refunded_quantity = 1 WHERE order_id = ${ord.id} AND product_id = ${kush.id}`)
await db.execute(sql`UPDATE orders SET status = 'partially_refunded', refunded_amount = '50', refunded_tax = '7.5', refunded_excise_tax = '5', refunded_sales_tax = '2.5' WHERE id = ${ord.id}`)

const afterRefund = await asOwner('POST', '/api/tax-filing/filings/generate', { filingType: 'excise_tax', ...period })
check('H16: a refunded unit leaves the taxable amount',
  Number(afterRefund.json?.total_taxable_amount ?? afterRefund.json?.totalTaxableAmount) === 50,
  { got: afterRefund.json?.total_taxable_amount ?? afterRefund.json?.totalTaxableAmount })
check('H16: ...and the tax due is net of the refund too',
  Number(afterRefund.json?.total_tax_due ?? afterRefund.json?.totalAmount) === 5,
  { got: afterRefund.json?.total_tax_due })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
