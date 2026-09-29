// crm-dispensary — T46 N14, N15, N17.
//
// N14  A recall could not answer "who bought it". The recall response and the batch detail listed no
//      affected orders and no customers, and there was no endpoint anywhere that could produce them
//      — order_items has carried batch_id since T45 BL4 and nothing ever read it back. The batch
//      quantity also stayed at 20 after a sale from it, so the lot's own count only moved when
//      someone destroyed something.
// N15  The receipt printed the server's clock: 8:46:46 PM for a sale the order page showed at
//      4:46:46 PM. The customer's copy and the shop's screen disagreed by four hours.
// N17  Excise due of $972.90 sat beside a taxable base of $6,849 — 14.2% against a 15% rate. The due
//      is the excise the tills actually took, which is charged on the DISCOUNTED base; the base
//      reported on the return did not subtract a penny of discount. A return whose own figures do
//      not divide into one another is the first thing an auditor asks about.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 340)) }
}

await setupSchema()

// Ohio, 15% excise and 8% sales tax — the rates the retest's shop runs.
const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-m2', email: 'm2@test.local', state: 'OH',
  taxRate: '8.0', exciseTaxRate: '15.0',
  enabledFeatures: ['products', 'orders', 'batches', 'compliance', 'tax_filing', 'contacts'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t46m2@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

const [kush] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '50', stockQuantity: 100,
  weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
} as any).returning()
const [tee] = await db.insert(product).values({
  name: 'Logo Tee', companyId: co.id, category: 'merch', price: '20', stockQuantity: 100,
  taxCategory: 'non_cannabis', trackInventory: true,
} as any).returning()

const ada = (await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1985-04-02',
  phone: '555-0101', email: 'ada@test.local',
} as any).returning())[0]
const walkIn = (await db.insert(contact).values({
  type: 'customer', name: 'Ben Buyer', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning())[0]

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/batches', (await import('./src/routes/batches.ts')).default)
app.route('/api/tax-filing', (await import('./src/routes/tax-filing.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner)
const asManager = as(manager)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// A lot of 20, which is what the retest recalled.
const [batch] = await rows(sql`
  INSERT INTO batches (id, batch_number, product_id, initial_quantity, current_quantity, status, company_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'T46-B-001', ${kush.id}, 20, 20, 'active', ${co.id}, NOW(), NOW())
  RETURNING id, batch_number
`)

/** A completed sale, optionally out of the batch and optionally discounted. */
const sell = async (opts: { contactId?: string | null; qty?: number; batch?: boolean; tees?: number; discount?: number }) => {
  const items: any[] = [{ productId: kush.id, quantity: opts.qty ?? 1 }]
  if (opts.tees) items.push({ productId: tee.id, quantity: opts.tees })
  const created = await asOwner('POST', '/api/orders', {
    type: 'walk_in', contactId: opts.contactId ?? null, idVerified: true, paymentMethod: 'cash',
    items, ...(opts.discount ? { discountAmount: opts.discount, discountReason: 'manager discount' } : {}),
  })
  if (created.status !== 201) return created
  if (opts.batch) {
    await db.execute(sql`UPDATE order_items SET batch_id = ${batch.id} WHERE order_id = ${created.json.id} AND product_id = ${kush.id}`)
  }
  const done = await asOwner('POST', `/api/orders/${created.json.id}/complete`, { paymentMethod: 'cash' })
  return { created, done, id: created.json.id, number: created.json.number }
}

// ═══════════════════════════════════════ N14 · who bought it ════════════════════════════════════
{
  const one = await sell({ contactId: ada.id, qty: 2, batch: true }) as any
  check('N14: a sale out of the batch completes', one.done?.status === 200, { status: one.done?.status, body: one.done?.json })

  const [afterSale] = await rows(sql`SELECT current_quantity FROM batches WHERE id = ${batch.id}`)
  check('N14: …and the batch comes down with it — it used to stay at 20',
    Number(afterSale?.current_quantity) === 18, afterSale)

  const two = await sell({ contactId: walkIn.id, qty: 1, batch: true }) as any
  check('N14: a second sale takes another off', Number((await rows(sql`SELECT current_quantity FROM batches WHERE id = ${batch.id}`))[0]?.current_quantity) === 17)
  void two

  // A sale that never touched the batch must not move it. It has to be a different PRODUCT: the
  // register assigns a sellable batch to a cannabis line by itself, so every eighth sold here comes
  // out of this lot whether the test says so or not — which is the behaviour, and is why the lot
  // has to move.
  const merchOnly = await asOwner('POST', '/api/orders', {
    type: 'walk_in', contactId: ada.id, idVerified: true, paymentMethod: 'cash',
    items: [{ productId: tee.id, quantity: 1 }],
  })
  await asOwner('POST', `/api/orders/${merchOnly.json.id}/complete`, { paymentMethod: 'cash' })
  check('N14: a sale of something else leaves the lot alone',
    Number((await rows(sql`SELECT current_quantity FROM batches WHERE id = ${batch.id}`))[0]?.current_quantity) === 17)

  const affected = await asOwner('GET', `/api/batches/${batch.id}/affected`)
  check('N14: the shop can ask who bought from a batch', affected.status === 200, { status: affected.status, body: affected.json })
  check('N14: …and gets the two orders that came out of it', affected.json?.orderCount === 2, affected.json)
  check('N14: …the units they hold', affected.json?.unitsSold === 3, affected.json)
  check('N14: …and how many customers to ring', affected.json?.customerCount === 2, affected.json)
  const withPhone = (affected.json?.orders || []).find((o: any) => o.customer?.phone === '555-0101')
  check('N14: …with the number to ring them on', !!withPhone, affected.json?.orders)
  check('N14: …and the order number they will quote', /^ORD-/.test(String(withPhone?.orderNumber)), withPhone)
  check('N14: …counting the ones there is no way to reach', affected.json?.unreachableOrders === 1, affected.json)

  // Recalling the batch hands the same list over, because that is the moment it is needed.
  const recalled = await asManager('POST', `/api/batches/${batch.id}/recall`)
  check('N14: recalling the batch works', recalled.status === 200, { status: recalled.status, body: recalled.json })
  check('N14: …and the recall itself says who has it', recalled.json?.affected?.orderCount === 2, recalled.json?.affected)
  check('N14: …with the customers on it', (recalled.json?.affected?.orders || []).some((o: any) => o.customer?.name === 'Ada Customer'), recalled.json?.affected?.orders)

  // Quarantining is not a recall and does not need the call list.
  const quarantined = await asManager('POST', `/api/batches/${batch.id}/quarantine`)
  check('N14: quarantining does not drag the list along', quarantined.json?.affected === undefined, Object.keys(quarantined.json || {}))
}

// ═══════════════════════════════════════════ N15 · the receipt ══════════════════════════════════
{
  // Merch, deliberately: the only cannabis lot in this shop has just been recalled and quarantined
  // by the block above, and the register correctly refuses to sell out of it.
  const created = await asOwner('POST', '/api/orders', {
    type: 'walk_in', contactId: ada.id, idVerified: true, paymentMethod: 'cash',
    items: [{ productId: tee.id, quantity: 1 }],
  })
  check('N15: a sale to print a receipt for', created.status === 201, { status: created.status, body: created.json })
  const sale = { id: created.json?.id }
  await asOwner('POST', `/api/orders/${sale.id}/complete`, { paymentMethod: 'cash' })
  const receipt = await asOwner('GET', `/api/orders/${sale.id}/receipt`)
  check('N15: the receipt prints', receipt.status === 200, receipt.status)
  const dateLine = /Date: ([^<]+)</.exec(receipt.text)?.[1] || ''
  check('N15: …with a date on it', !!dateLine.trim(), dateLine)
  check('N15: …naming the clock it used, so nobody has to guess', /\b(EDT|EST|GMT|UTC)\b/.test(dateLine), dateLine)
  check('N15: …and it is the SHOP\'s clock, not the server\'s', /\b(EDT|EST)\b/.test(dateLine), dateLine)

  // The same instant, rendered in the shop's zone, is what the order page shows.
  const [row] = await rows(sql`SELECT created_at FROM orders WHERE id = ${sale.id}`)
  const expected = new Date(row.created_at as any).toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' })
  check('N15: …matching what the screen beside it shows', dateLine.trim() === expected, { onReceipt: dateLine.trim(), onScreen: expected })
}

// ═══════════════════════════════════ N17 · the return ties out ══════════════════════════════════
{
  // A fresh shop, so the figures are only the ones this block creates.
  const [co2] = await db.insert(company).values({
    name: 'Tie Out Leaf', slug: 'leaf-tie', email: 'tie@test.local', state: 'OH',
    taxRate: '8.0', exciseTaxRate: '15.0',
    enabledFeatures: ['products', 'orders', 'tax_filing', 'contacts'],
  } as any).returning()
  const [owner2] = await db.insert(user).values({
    email: 'owner-tie@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co2.id,
  } as any).returning()
  const [flower2] = await db.insert(product).values({
    name: 'Tie Flower', companyId: co2.id, category: 'flower', price: '100', stockQuantity: 100,
    weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const [merch2] = await db.insert(product).values({
    name: 'Tie Tee', companyId: co2.id, category: 'merch', price: '50', stockQuantity: 100,
    taxCategory: 'non_cannabis', trackInventory: true,
  } as any).returning()
  const [cust2] = await db.insert(contact).values({
    type: 'customer', name: 'Tie Customer', companyId: co2.id, dateOfBirth: '1985-04-02',
  } as any).returning()

  const as2 = as(owner2)
  // $100 of cannabis + $50 of merch, with $30 off. The till taxes excise on
  // 100 − 30×(100/150) = $80, so $12 of excise is due on a base of $80.
  const created = await as2('POST', '/api/orders', {
    type: 'walk_in', contactId: cust2.id, idVerified: true, paymentMethod: 'cash',
    items: [{ productId: flower2.id, quantity: 1 }, { productId: merch2.id, quantity: 1 }],
    discountAmount: 30, discountReason: 'manager discount',
  })
  check('N17: a discounted sale is rung up', created.status === 201, { status: created.status, body: created.json })
  const done = await as2('POST', `/api/orders/${created.json.id}/complete`, { paymentMethod: 'cash' })
  check('N17: …and completed', done.status === 200, { status: done.status, body: done.json })

  const [sale] = await rows(sql`SELECT excise_tax, sales_tax, subtotal, discount_amount FROM orders WHERE id = ${created.json.id}`)
  check('N17: the till charged excise on the discounted cannabis base — 15% of $80', Number(sale?.excise_tax) === 12, sale)

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const filing = await as2('POST', '/api/tax-filing/filings/generate', {
    filingType: 'excise_tax', periodStart: today, periodEnd: today,
  })
  check('N17: an excise return generates', filing.status === 200 || filing.status === 201, { status: filing.status, body: filing.json })

  // The generated return is stored as the row plus its working in filing_data, which is where the
  // screen reads the figures from.
  const data = typeof filing.json?.filing_data === 'string' ? JSON.parse(filing.json.filing_data) : (filing.json?.filing_data || {})
  const base = Number(data.taxableSales ?? filing.json?.total_taxable_amount)
  const due = Number(data.exciseTaxDue ?? filing.json?.total_tax_due)
  check('N17: …on a base of $80, not the $100 before the discount', base === 80, { taxableSales: base })
  check('N17: …with $12 due', due === 12, { due })
  check('N17: …and the two divide into the rate the shop charges — 15%',
    Math.abs((due / base) * 100 - 15) < 0.01, { base, due, impliedRate: base ? (due / base) * 100 : null })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
