// crm-dispensary — the core-shop items from T45, the ones that stand between this and being sellable.
//
//   H1   Settings → Loyalty replaced settings.loyalty wholesale, so pressing Save with no edits at
//        all deleted the welcome and birthday bonuses and the next new member got 0 instead of 50.
//   H2   CSV import skipped every check the forms enforce: "not-an-email", an HTML name, a
//        spreadsheet-formula name, a −$5 price, a category of "spaceship", a duplicate SKU — and it
//        dropped the date of birth column entirely, so a 2012-born customer imported cleanly into a
//        shop that may not sell to them.
//   H3   …and then the register sold the −$5 product, cancelling out a $25 T-shirt beside it and
//        ringing the whole sale at $0.00.
//   H19  Not one settings change reached the audit log — not a tax rate, not the purchase limit.
//   H20  A budtender could mark any order "delivered", including an unpaid pending walk-in that was
//        never a delivery.
//   M5   The register's weight meter summed raw grams while the limit is written in flower
//        equivalent, so it read 0.2 oz and the server refused the finished basket at 1.31 oz.
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
  name: 'Core Dispensary', slug: 'core', email: 'core@test.local', state: 'OH',
  purchaseLimitOz: '1',
  settings: { loyalty: { enabled: true, pointsPerDollar: 1, welcomePoints: 50, birthdayBonus: 25, tierThresholds: { bronze: 0, silver: 500, gold: 1500, platinum: 5000 } } },
  enabledFeatures: ['orders', 'products', 'loyalty_rewards', 'delivery', 'equivalency'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-core@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const budtender = await mkUser('user', 'budtender')

const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/orders', 'orders'],
  ['/api/company', 'company'],
  ['/api/import', 'import'],
  // H2 compares the CSV importer's underage refusal with the FORM's, word for word — they used to
  // be two copies of one sentence. (T52 N6)
  ['/api/contacts', 'contacts'],
  ['/api/delivery', 'delivery'],
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
const asBudtender = as(budtender)

const storedSettings = async () => {
  const r: any = await db.execute(sql`SELECT settings FROM company WHERE id = ${co.id}`)
  return ((r as any).rows || r)?.[0]?.settings || {}
}

// ── H1: saving the loyalty tab must not delete what the tab does not show ──────────────────────
check('H1: setup — the shop has a welcome and a birthday bonus', (await storedSettings()).loyalty?.welcomePoints === 50)

// Exactly what the fixed screen sends: the server's own flat keys, no settings.loyalty block.
const save = await asOwner('PUT', '/api/company', {
  loyaltyEnabled: true,
  loyaltyPointsPerDollar: 1,
  loyaltyWelcomePoints: 50,
  loyaltyBirthdayBonus: 25,
  loyaltyTierThresholds: { bronze: 0, silver: 500, gold: 1500, platinum: 5000 },
})
check('H1: the loyalty tab saves', save.status === 200, { status: save.status, body: save.json })
const afterSave = await storedSettings()
check('H1: the welcome bonus survived the save', afterSave.loyalty?.welcomePoints === 50, afterSave.loyalty)
check('H1: ...and the birthday bonus', afterSave.loyalty?.birthdayBonus === 25, afterSave.loyalty)
check('H1: ...and the real tier ladder, not the screen\'s placeholders',
  afterSave.loyalty?.tierThresholds?.gold === 1500, afterSave.loyalty?.tierThresholds)
check('H1: the server reports the ladder back so the screen can show the real numbers',
  save.json?.loyaltyTierThresholds?.gold === 1500 && save.json?.loyaltyWelcomePoints === 50,
  { thresholds: save.json?.loyaltyTierThresholds, welcome: save.json?.loyaltyWelcomePoints })

// ── H19: a settings change is now on the record ────────────────────────────────────────────────
const rateChange = await asOwner('PUT', '/api/company', { exciseTaxRate: 12 })
check('H19: the rate change saves', rateChange.status === 200, rateChange.status)
const logged: any = await db.execute(sql`SELECT action, entity, metadata FROM audit_log WHERE entity = 'company' ORDER BY created_at DESC LIMIT 5`)
const logRows = ((logged as any).rows || logged)
check('H19: company settings changes reach the audit log at all', logRows.length > 0, logRows.length)
const meta = (r: any) => (typeof r?.metadata === 'string' ? JSON.parse(r.metadata) : r?.metadata) || {}
check('H19: ...naming the field that changed',
  logRows.some((r: any) => (meta(r).fields || []).includes('exciseTaxRate')),
  logRows.map((r: any) => meta(r).fields))

// ── H2: import applies the rules the forms apply ───────────────────────────────────────────────
const importCsv = async (type: string, csv: string) => {
  const form = new FormData()
  form.append('file', new File([csv], 'x.csv', { type: 'text/csv' }))
  const res = await app.request(`/api/import/${type}`, { method: 'POST', headers: { 'x-test-user': owner.id }, body: form })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

const badCustomers = [
  'name,email,date_of_birth',
  'Good Customer,good@example.com,1980-05-05',
  'Bad Email,not-an-email,1980-05-05',
  '<img src=x onerror=alert(1)>,html@example.com,1980-05-05',
  '"=HYPERLINK(evil)",formula@example.com,1980-05-05',
  'Child Customer,child@example.com,2012-01-01',
].join('\n')
const custResult = await importCsv('contacts', badCustomers)
check('H2: the import runs', custResult.status === 200 || custResult.status === 201, { status: custResult.status, body: custResult.json })
check('H2: only the good row is imported', custResult.json?.imported === 1, { imported: custResult.json?.imported, skipped: custResult.json?.skipped })
const errText = JSON.stringify(custResult.json?.errors || [])
check('H2: "not-an-email" is refused', /not a valid email/i.test(errText), errText.slice(0, 200))
check('H2: an HTML name is refused', /contains HTML/i.test(errText), errText.slice(0, 200))
check('H2: a spreadsheet formula name is refused', /formula character/i.test(errText), errText.slice(0, 200))
// The same rule AND the same words. The importer and the form each carried their own copy of this
// sentence until T52 N6, which is how the copy on the form could be corrected and the one in the
// importer left saying something else. Asserting the shared text is what stops that happening again.
{
  const formRefusal = await asOwner('POST', '/api/contacts', { name: 'H2 Child', type: 'customer', dateOfBirth: '2012-01-01' })
  const formSaid = String(formRefusal.json?.error || '')
  check('H2: the form refuses a 2012-born customer', formRefusal.status === 400, formRefusal.json)
  check('H2: a 2012-born customer is refused by the same age rule the form uses',
    /nobody under 18 can be a cannabis customer/i.test(errText), errText.slice(0, 300))
  // Both say "…would be N years old, and nobody under 18…"; only the name at the front differs.
  const shared = (s: string) => s.replace(/^.*?would be/, 'would be')
  check('H2: …and in the same words, from one definition',
    !!formSaid && errText.includes(shared(formSaid)), { form: formSaid.slice(0, 160), csv: errText.slice(0, 240) })
}

const savedCustomer: any = await db.execute(sql`SELECT name, date_of_birth FROM contact WHERE email = 'good@example.com'`)
const sc = ((savedCustomer as any).rows || savedCustomer)?.[0]
check('H2: the date of birth column is read at last — it used to be dropped for every row',
  String(sc?.date_of_birth || '').slice(0, 10) === '1980-05-05', sc)

await db.insert(product).values({
  name: 'Existing', sku: 'DUP-1', category: 'flower', price: '10', companyId: co.id, stockQuantity: 1,
} as any)
const badProducts = [
  'name,sku,category,price',
  'Fine Product,OK-1,flower,10',
  'Cheap Trick,NEG-1,flower,-5',
  'Spaceship,SPC-1,spaceship,10',
  'Clash,DUP-1,flower,10',
].join('\n')
const prodResult = await importCsv('products', badProducts)
check('H2: only the good product is imported', prodResult.json?.imported === 1, { imported: prodResult.json?.imported, errors: prodResult.json?.errors })
const prodErrs = JSON.stringify(prodResult.json?.errors || [])
check('H2: a negative price is refused', /cannot be negative/i.test(prodErrs), prodErrs.slice(0, 200))
check('H2: "spaceship" is refused as a category', /not a product category/i.test(prodErrs), prodErrs.slice(0, 200))
check('H2: a duplicate SKU is refused', /already used/i.test(prodErrs), prodErrs.slice(0, 200))

// ── H3: even if a bad price exists, the till refuses it ────────────────────────────────────────
const [negative] = await db.insert(product).values({
  name: 'Negative Product', sku: 'NEG-DIRECT', category: 'accessory', price: '-5',
  stockQuantity: 10, trackInventory: true, taxCategory: 'non_cannabis', companyId: co.id,
} as any).returning()
const [shirt] = await db.insert(product).values({
  name: 'T-Shirt', sku: 'TS-1', category: 'accessory', price: '25',
  stockQuantity: 10, trackInventory: true, taxCategory: 'non_cannabis', companyId: co.id,
} as any).returning()

const zeroSale = await asOwner('POST', '/api/orders', {
  contactId: cust.id,
  items: [{ productId: negative.id, quantity: 1 }, { productId: shirt.id, quantity: 1 }],
  type: 'walk_in', idVerified: true, paymentMethod: 'cash',
})
check('H3: a negative-price line is refused at the till', zeroSale.status === 400, { status: zeroSale.status, body: zeroSale.json })
check('H3: ...naming the product and its price', /Negative Product/.test(String(zeroSale.json?.error)) && zeroSale.json?.code === 'invalid_price', zeroSale.json)
const shirtOnly = await asOwner('POST', '/api/orders', {
  contactId: cust.id, items: [{ productId: shirt.id, quantity: 1 }],
  type: 'walk_in', idVerified: true, paymentMethod: 'cash',
})
check('H3: the good product still sells', shirtOnly.status === 201, shirtOnly.status)
check('H3: ...for its real price, not zero', Number(shirtOnly.json?.subtotal) === 25, shirtOnly.json?.subtotal)

// ── H20: "delivered" means delivered ───────────────────────────────────────────────────────────
const walkIn = await asOwner('POST', '/api/orders', {
  contactId: cust.id, items: [{ productId: shirt.id, quantity: 1 }],
  type: 'walk_in', idVerified: true, paymentMethod: 'cash',
})
const mark = await asBudtender('PUT', `/api/delivery/orders/${walkIn.json?.id}/status`, { deliveryStatus: 'delivered' })
check('H20: an unpaid walk-in cannot be marked delivered', mark.status === 400, { status: mark.status, body: mark.json })
check('H20: ...because it is not a delivery at all', mark.json?.code === 'not_a_delivery', mark.json?.code)
const row: any = await db.execute(sql`SELECT delivery_status, delivered_at FROM orders WHERE id = ${walkIn.json?.id}`)
const r0 = ((row as any).rows || row)?.[0]
check('H20: ...and nothing was recorded', !r0?.delivered_at, r0)

// A delivery needs somewhere to go — the customer here has no address on file, so the order says
// where. (T45 M10)
const del = await asOwner('POST', '/api/orders', {
  contactId: cust.id, items: [{ productId: shirt.id, quantity: 1 }],
  type: 'delivery', idVerified: true, paymentMethod: 'cash',
  deliveryAddress: '1 Main St, Columbus, OH 43004',
})
const earlyDeliver = await asBudtender('PUT', `/api/delivery/orders/${del.json?.id}/status`, { deliveryStatus: 'delivered' })
check('H20: a real delivery that has not been settled cannot be marked delivered either',
  earlyDeliver.status === 400 && earlyDeliver.json?.code === 'order_not_settled', earlyDeliver.json)
check('H20: ...but moving it along the route is still allowed',
  (await asBudtender('PUT', `/api/delivery/orders/${del.json?.id}/status`, { deliveryStatus: 'en_route' })).status === 200)

await asOwner('POST', `/api/orders/${del.json?.id}/complete`, { paymentMethod: 'cash', cashTendered: 10000 })
const nowDeliver = await asBudtender('PUT', `/api/delivery/orders/${del.json?.id}/status`, { deliveryStatus: 'delivered' })
check('H20: once settled, it can be marked delivered', nowDeliver.status === 200, { status: nowDeliver.status, body: nowDeliver.json })

// ── M5: the meter and the refusal are the same arithmetic ──────────────────────────────────────
const [conc] = await db.insert(product).values({
  name: 'Shatter', sku: 'SH-1', category: 'concentrate', price: '40',
  weightGrams: '1', stockQuantity: 100, trackInventory: true, taxCategory: 'cannabis', companyId: co.id,
} as any).returning()
// The shop's own rule: a gram of concentrate counts as 2.5 g of flower.
await db.execute(sql`
  INSERT INTO equivalency_rules (id, company_id, state, category, equivalency_factor, unit_of_measure, is_active, created_at)
  VALUES (gen_random_uuid(), ${co.id}, 'OH', 'concentrate', '2.5', 'grams', true, NOW())
`)

const quote = await asOwner('POST', '/api/equivalency/calculate', { items: [{ productId: conc.id, quantity: 8 }] })
check('M5: the register can ask what a basket weighs', quote.status === 200, { status: quote.status, body: quote.json })
// 8 g of concentrate x 2.5 = 20 g flower equivalent = 0.71 oz, under a 1 oz cap.
check('M5: ...and the answer applies the shop\'s equivalency rule, not raw grams',
  Math.abs(Number(quote.json?.totalFlowerEquivalentGrams) - 20) < 0.01,
  { grams: quote.json?.totalFlowerEquivalentGrams, note: '8g x 2.5 = 20g, not 8g' })
check('M5: ...against the shop\'s own limit', Number(quote.json?.purchaseLimitOz) === 1, quote.json?.purchaseLimitOz)
check('M5: 8 g is under the cap', quote.json?.isOverLimit === false, quote.json)

const over = await asOwner('POST', '/api/equivalency/calculate', { items: [{ productId: conc.id, quantity: 12 }] })
check('M5: 12 g of concentrate is over it', over.json?.isOverLimit === true, over.json)
check('M5: ...and the quote carries the refusal wording the till will show',
  typeof over.json?.limitError === 'string' && /exceeds/i.test(over.json.limitError), over.json?.limitError)

// The quote and the actual sale must agree — that disagreement IS the finding.
const realSale = await asOwner('POST', '/api/orders', {
  contactId: cust.id, items: [{ productId: conc.id, quantity: 12 }],
  type: 'walk_in', idVerified: true, paymentMethod: 'cash',
})
check('M5: the sale refuses exactly what the quote said it would', realSale.status === 400, { status: realSale.status, body: realSale.json })
const underSale = await asOwner('POST', '/api/orders', {
  contactId: cust.id, items: [{ productId: conc.id, quantity: 8 }],
  type: 'walk_in', idVerified: true, paymentMethod: 'cash',
})
check('M5: ...and accepts exactly what the quote allowed', underSale.status === 201, { status: underSale.status, body: underSale.json })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
