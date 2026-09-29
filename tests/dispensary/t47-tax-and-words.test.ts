// crm-dispensary — T47 P5 and P12.
//
// P5  The excise return's three figures still did not divide: taxable $7,079 beside $998.40 due is
//     14.1%, not the 15% printed on it. Neither number was wrong on its own — the due is the excise
//     the tills actually took, and the tills charge a registered patient NOTHING (utils/tax.ts,
//     medicalExciseExempt). It was the BASE that hid something: it counted medical sales that were
//     never charged a penny of excise. A return whose own figures do not divide is the first thing an
//     auditor asks about, and the shop cannot explain it.
//
// P12 Refusals still read like code — "items.0.quantity: Expected number, received string",
//     "items: Array must contain at least 1 element(s)" — and every one shipped the validator's whole
//     issue list. At the PUBLIC CHECKOUT the reader is a customer with a basket.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'
import { zodRefusal } from './src/utils/errors.ts'
import { z } from 'zod'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t47tx', email: 'tx@test.local', state: 'OH',
  exciseTaxRate: '15', salesTaxRate: '0',
  enabledFeatures: ['products', 'orders', 'compliance', 'tax_filing'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t47tx@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const [adult] = await db.insert(contact).values({ name: 'Addie Adult', type: 'customer', companyId: co.id } as any).returning()
const [patient] = await db.insert(contact).values({
  name: 'Pat Patient', type: 'customer', companyId: co.id, isMedical: true, medicalCardNumber: 'OH-MED-1',
} as any).returning()

const [flower] = await db.insert(product).values({
  name: 'Blue Dream', companyId: co.id, category: 'flower', price: '100', weightGrams: '3.5',
  stockQuantity: 500, taxCategory: 'cannabis', trackInventory: true,
} as any).returning()

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/tax-filing', (await import('./src/routes/tax-filing.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ═════════════════ P5 · a return whose figures divide into one another ══════════════════════════
{
  // Four adult-use sales at $100, and one to a registered patient. The patient pays no excise.
  for (let i = 0; i < 4; i++) {
    const r = await api('POST', '/api/orders', { items: [{ productId: flower.id, quantity: 1 }], orderType: 'walk_in', contactId: adult.id })
    const id = (r.json?.data || r.json)?.id
    await db.execute(sql`UPDATE orders SET status = 'completed', completed_at = NOW() WHERE id = ${id}`)
  }
  const med = await api('POST', '/api/orders', { items: [{ productId: flower.id, quantity: 1 }], orderType: 'walk_in', contactId: patient.id })
  const medId = (med.json?.data || med.json)?.id
  await db.execute(sql`UPDATE orders SET status = 'completed', completed_at = NOW() WHERE id = ${medId}`)

  const [medRow] = await rows(sql`SELECT is_medical, excise_tax FROM orders WHERE id = ${medId}`)
  check('P5: the patient\'s sale is marked medical', medRow?.is_medical === true, medRow?.is_medical)
  check('P5: …and was charged no excise, which is the whole reason the figures stopped dividing',
    Math.round(Number(medRow?.excise_tax || 0) * 100) === 0, medRow?.excise_tax)

  const today = new Date().toISOString().slice(0, 10)
  const filing = await api('POST', '/api/tax-filing/filings/generate', {
    filingType: 'excise_tax', periodStart: today, periodEnd: today,
  })
  check('P5: an excise filing is generated', filing.status === 200 || filing.status === 201, filing.json)

  const raw = filing.json?.filing_data ?? filing.json?.filingData
  const d = typeof raw === 'string' ? JSON.parse(raw) : raw
  const taxable = Number(d?.taxableSales)
  const due = Number(d?.exciseTaxDue)
  const exempt = Number(d?.exemptSales)

  check('P5: the exempt medical sales are on their own line', exempt === 100, { exempt, d: { taxable, due } })
  check('P5: …and are OUT of the taxable base', taxable === 400, taxable)
  check('P5: …so the due is exactly the base at the headline rate', Math.round(due * 100) === Math.round(400 * 0.15 * 100), { due, want: 60 })
  check('P5: …and the three figures divide: 60 / 400 = 15%', Math.abs(Number(d?.effectiveRate) - 15) < 0.05, d?.effectiveRate)
  check('P5: …with the basis saying what was left out and why',
    /exempt/i.test(String(d?.taxableBasis)) && /medical/i.test(String(d?.exemptBasis)), { basis: d?.taxableBasis, exempt: d?.exemptBasis })
  check('P5: …and the basis no longer says only "net of refunds" while the base is net of discounts too',
    /discount/i.test(String(d?.taxableBasis)), d?.taxableBasis)

  // On a shop whose till has always charged correctly, the return reconciles and says so.
  check('P5: …the return states what it should come to at the configured rate', Number(d?.expectedAtRate) === 60, d?.expectedAtRate)
  check('P5: …and that it reconciles', d?.reconciles === true, { reconciles: d?.reconciles, variance: d?.collectedVariance })
  check('P5: …with nothing to explain', d?.reconcileNote === null, d?.reconcileNote)
}

// ═════════ P5c · a return that does NOT divide says so, instead of printing a rate ═══════════════
//
// Found on the live tenant, which the unit case could never have shown: with clean data the
// figures agree, and disptest lands at 14.38% because some of its sales were recorded with no
// excise at all — orders written straight into the database by earlier test scripts. The filing
// was right both times; what it did not do was EXPLAIN itself. A return that prints 14.38% beside
// a 15% rate and leaves the reader to notice is the original complaint wearing a smaller hat.
{
  const [odd] = await db.insert(company).values({
    name: 'Undercharging Leaf', slug: 'leaf-t47tx3', email: 'tx3@test.local', state: 'OH',
    exciseTaxRate: '15', salesTaxRate: '0',
    enabledFeatures: ['products', 'orders', 'compliance', 'tax_filing'],
  } as any).returning()
  const owner3 = (await db.insert(user).values({
    email: 'owner-t47tx3@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: odd.id,
  } as any).returning())[0]
  const [bud] = await db.insert(product).values({
    name: 'Blue Dream', companyId: odd.id, category: 'flower', price: '100', weightGrams: '3.5',
    stockQuantity: 50, taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()

  const ring = async (body: unknown) => await app.request('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': owner3.id, 'x-test-company': odd.id, 'x-test-role': 'owner' },
    body: JSON.stringify(body),
  })
  const r = await ring({ items: [{ productId: bud.id, quantity: 1 }], orderType: 'walk_in' })
  const made: any = await r.json().catch(() => ({}))
  const oid = (made?.data || made)?.id
  // …and then the thing a real shop does by accident: a sale recorded with no excise on it.
  await db.execute(sql`UPDATE orders SET status = 'completed', completed_at = NOW(), excise_tax = '0' WHERE id = ${oid}`)

  const today = new Date().toISOString().slice(0, 10)
  const res = await app.request('/api/tax-filing/filings/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': owner3.id, 'x-test-company': odd.id, 'x-test-role': 'owner' },
    body: JSON.stringify({ filingType: 'excise_tax', periodStart: today, periodEnd: today }),
  })
  const j: any = await res.json().catch(() => ({}))
  const raw3 = j?.filing_data ?? j?.filingData
  const d3 = typeof raw3 === 'string' ? JSON.parse(raw3) : raw3

  check('P5: a period whose excise does not match the rate is reported as not reconciling', d3?.reconciles === false,
    { reconciles: d3?.reconciles, taxable: d3?.taxableSales, due: d3?.exciseTaxDue })
  check('P5: …naming the shortfall in money', Math.abs(Number(d3?.collectedVariance) + 15) < 0.01, d3?.collectedVariance)
  check('P5: …and what it should have been', Number(d3?.expectedAtRate) === 15, d3?.expectedAtRate)
  check('P5: …with a sentence saying where to look', /less than 15% of the taxable base/i.test(String(d3?.reconcileNote)), d3?.reconcileNote)
}

// ══════════ P5b · a shop whose state taxes patients gets no exempt line ══════════════════════════
{
  const [taxing] = await db.insert(company).values({
    name: 'Taxing State Leaf', slug: 'leaf-t47tx2', email: 'tx2@test.local', state: 'XX',
    exciseTaxRate: '15', salesTaxRate: '0',
    settings: { tax: { medicalExciseExempt: false } },
    enabledFeatures: ['products', 'orders', 'compliance', 'tax_filing'],
  } as any).returning()
  const owner2 = (await db.insert(user).values({
    email: 'owner-t47tx2@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: taxing.id,
  } as any).returning())[0]
  const today = new Date().toISOString().slice(0, 10)
  const res = await app.request('/api/tax-filing/filings/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': owner2.id, 'x-test-company': taxing.id, 'x-test-role': 'owner' },
    body: JSON.stringify({ filingType: 'excise_tax', periodStart: today, periodEnd: today }),
  })
  const j: any = await res.json().catch(() => ({}))
  const raw2 = j?.filing_data ?? j?.filingData
  const d = typeof raw2 === 'string' ? JSON.parse(raw2) : raw2
  check('P5: a state that DOES tax patients gets no exempt line', Number(d?.exemptSales || 0) === 0, d?.exemptSales)
  check('P5: …and its basis does not mention an exemption', !/exempt/i.test(String(d?.taxableBasis || '')), d?.taxableBasis)
}

// ══════════════════════ P12 · a refusal a customer can act on ═══════════════════════════════════
{
  const refuse = (schema: z.ZodTypeAny, value: unknown) => {
    const parsed = schema.safeParse(value)
    return parsed.success ? null : zodRefusal(parsed.error)
  }

  const basket = z.object({ items: z.array(z.object({ quantity: z.number(), productId: z.string() })).min(1) })

  const empty = refuse(basket, { items: [] })
  check('P12: an empty basket is refused in words', empty?.error === 'Add at least one item.', empty?.error)
  check('P12: …with no "Array must contain at least 1 element(s)" anywhere',
    !/Array must contain/.test(String(empty?.error)), empty?.error)

  const wrongType = refuse(basket, { items: [{ quantity: '2', productId: 'p1' }] })
  check('P12: a quantity sent as text names the item and says what is wrong',
    wrongType?.error === 'item 1 quantity has to be a number.', wrongType?.error)
  check('P12: …counting items from ONE, because "item 0" means nothing to a customer',
    /item 1/.test(String(wrongType?.error)), wrongType?.error)
  check('P12: …while the machine-readable path is still there for the form', wrongType?.field === 'items.0.quantity', wrongType?.field)

  const missing = refuse(z.object({ deliveryAddress: z.string() }), {})
  check('P12: a missing field is asked for by name, in plain English',
    missing?.error === 'delivery address is required.', missing?.error)

  const tooShort = refuse(z.object({ licenseNumber: z.string().min(1) }), { licenseNumber: '' })
  check('P12: an empty text field says it cannot be blank', tooShort?.error === 'license number cannot be blank.', tooShort?.error)

  const tooSmall = refuse(z.object({ referrerRewardValue: z.number().min(0) }), { referrerRewardValue: -5 })
  check('P12: a number below its floor says so', tooSmall?.error === 'referrer reward value must be 0 or more.', tooSmall?.error)

  const badEmail = refuse(z.object({ email: z.string().email() }), { email: 'nope' })
  check('P12: a bad email says what it is not', /does not look like an email/.test(String(badEmail?.error)), badEmail?.error)

  // …and the validator's internals never leave the building.
  check('P12: no refusal carries the validator dump any more', !('details' in (empty || {})), Object.keys(empty || {}))
  for (const r of [empty, wrongType, missing, tooShort, tooSmall, badEmail]) {
    check(`P12: "${String(r?.error).slice(0, 34)}…" reads as a sentence`,
      !/Expected \w+, received|Array must|String must|Number must|ZodError/.test(String(r?.error)), r?.error)
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
