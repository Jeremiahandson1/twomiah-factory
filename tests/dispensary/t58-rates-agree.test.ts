// crm-dispensary — Settings, the register and the recorded order must name ONE tax rate.
//
//   "Dispensary: two tax-rate settings disagree."
//
// There were three answers to "what rate applies when none is configured", in three files:
//
//   Settings → General   pick(company.taxRate, settings.taxRate, '0')    showed 0%
//   the register         useState(0), and Number(null) is a finite 0      quoted 0%
//   the server           utils/tax.ts DEFAULT_SALES_RATE                 charged 8.75%
//
// A shop that had never typed a sales-tax rate was shown 0%, quoted 0% at the counter, and had the sale
// recorded at 8.75%: told one total, charged another. Go-live QA M-1 was the same fault and was closed
// only for the case where the column HAS a value.
//
// What is asserted is the INVARIANT, not any particular percentage: the rate GET /api/company
// advertises is the rate a completed sale is actually charged. That holds whether the operator set a
// rate or left it to the default, and it is what both screens now read instead of each keeping a
// default of its own.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) < tol

await setupSchema()

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)

const call = (who: string) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

/** A shop, its till, and one cannabis product priced so the tax is easy to read. */
const shop = async (slug: string, rates: { taxRate?: string | null; exciseTaxRate?: string | null }) => {
  const [co] = await db.insert(company).values({
    name: slug, slug, email: `${slug}@test.local`, state: 'OH',
    taxRate: rates.taxRate as any, exciseTaxRate: rates.exciseTaxRate as any,
    purchaseLimitOz: '2.5',
    enabledFeatures: ['products', 'orders', 'dashboard', 'cash_management'],
  } as any).returning()
  const [owner] = await db.insert(user).values({
    email: `owner-${slug}@test.local`, passwordHash: 'x', firstName: 'O', lastName: 'U',
    role: 'owner', companyId: co.id,
  } as any).returning()
  const [prod] = await db.insert(product).values({
    name: 'OG Kush', companyId: co.id, category: 'flower', price: '100', stockQuantity: 500,
    weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const [cust] = await db.insert(contact).values({
    type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1985-04-02',
  } as any).returning()
  await db.execute(sql`
    INSERT INTO cash_sessions (id, company_id, user_id, opened_at, status)
    VALUES (${`cs-${slug}`}, ${co.id}, ${owner.id}, now(), 'open')
  `)
  return { co, owner, prod, cust, api: call(owner.id) }
}

/** Sell one unit and read back what the server actually recorded. */
const sellAndRead = async (s: Awaited<ReturnType<typeof shop>>) => {
  const made = await s.api('POST', '/api/orders', { contactId: s.cust.id, items: [{ productId: s.prod.id, quantity: 1 }] })
  const id = made.json?.id ?? made.json?.order?.id
  const done = await s.api('POST', `/api/orders/${id}/complete`, { paymentMethod: 'cash', cashTendered: 1000, idVerified: true })
  const row: any = ((await db.execute(sql`
    SELECT subtotal, sales_tax, excise_tax, total_tax, discount_amount FROM orders WHERE id = ${id}
  `) as any).rows || [])[0] || {}
  return { id, made, done, row }
}

// ══════════ 1. nothing configured — the case that disagreed ════════════════════════════════════════
console.log('\n══════════ a shop that never typed a rate ══════════')
{
  const s = await shop('rates-unset-t58', { taxRate: null, exciseTaxRate: null })
  const co = await s.api('GET', '/api/company')
  check('GET /api/company answers', co.status === 200, { status: co.status, body: co.text?.slice(0, 200) })
  const body = co.json ?? {}

  check('it says the sales rate is a default, not a choice', body.taxRateIsDefault === true, { taxRateIsDefault: body.taxRateIsDefault })
  check('…and names the rate that will be charged', Number(body.effectiveTaxRate) > 0,
    { effectiveTaxRate: body.effectiveTaxRate })
  check('the excise rate likewise', body.exciseTaxRateIsDefault === true && Number(body.effectiveExciseTaxRate) > 0,
    { isDefault: body.exciseTaxRateIsDefault, effective: body.effectiveExciseTaxRate })
  // The raw column is still empty — the effective value is derived, not written behind the operator.
  const stored: any = ((await db.execute(sql`SELECT tax_rate, excise_tax_rate FROM company WHERE id = ${s.co.id}`) as any).rows || [])[0] || {}
  check('…and nothing was written into the column', (stored.tax_rate ?? '') === '' || stored.tax_rate == null,
    { tax_rate: stored.tax_rate })

  const sold = await sellAndRead(s)
  check('the sale completes', sold.done.status === 200 || sold.done.status === 201, { status: sold.done.status, body: sold.done.text?.slice(0, 200) })

  // THE INVARIANT: what the API advertises is what the till charged.
  const base = Number(sold.row.subtotal) || 0
  const salesCharged = Number(sold.row.sales_tax) || 0
  const exciseCharged = Number(sold.row.excise_tax) || 0
  check('the sales tax charged matches the advertised effective rate',
    base > 0 && near(salesCharged, base * (Number(body.effectiveTaxRate) / 100), 0.02),
    { base, salesCharged, effectiveTaxRate: body.effectiveTaxRate, expected: base * (Number(body.effectiveTaxRate) / 100) })
  check('the excise charged matches the advertised effective rate',
    base > 0 && near(exciseCharged, base * (Number(body.effectiveExciseTaxRate) / 100), 0.02),
    { base, exciseCharged, effectiveExciseTaxRate: body.effectiveExciseTaxRate })
  // The old bug in one line: the raw column reads as 0, and 0 is NOT what was charged.
  check('…and the raw column, read as a number, is NOT what was charged — the old bug',
    salesCharged > 0 && Number(stored.tax_rate ?? 0) === 0,
    { columnAsNumber: Number(stored.tax_rate ?? 0), salesCharged })
}

// ══════════ 2. a configured rate is still honoured ═════════════════════════════════════════════════
console.log('\n══════════ a shop that set its rates ══════════')
{
  const s = await shop('rates-set-t58', { taxRate: '6.25', exciseTaxRate: '12' })
  const co = await s.api('GET', '/api/company')
  const body = co.json ?? {}
  check('the effective sales rate is the one configured', near(Number(body.effectiveTaxRate), 6.25), { effectiveTaxRate: body.effectiveTaxRate })
  check('the effective excise rate is the one configured', near(Number(body.effectiveExciseTaxRate), 12), { effectiveExciseTaxRate: body.effectiveExciseTaxRate })
  check('…and neither is flagged as a default', body.taxRateIsDefault === false && body.exciseTaxRateIsDefault === false,
    { tax: body.taxRateIsDefault, excise: body.exciseTaxRateIsDefault })

  const sold = await sellAndRead(s)
  const base = Number(sold.row.subtotal) || 0
  check('the sale is charged 6.25% sales tax', near(Number(sold.row.sales_tax) || 0, base * 0.0625, 0.02),
    { base, salesTax: sold.row.sales_tax })
  check('…and 12% excise', near(Number(sold.row.excise_tax) || 0, base * 0.12, 0.02),
    { base, exciseTax: sold.row.excise_tax })
  check('…and the advertised rate still equals the charged rate',
    base > 0 && near(Number(sold.row.sales_tax) || 0, base * (Number(body.effectiveTaxRate) / 100), 0.02),
    { effectiveTaxRate: body.effectiveTaxRate, salesTax: sold.row.sales_tax })
}

// ══════════ 3. a zero rate is a CHOICE, not an absent value ════════════════════════════════════════
console.log('\n══════════ a shop that deliberately charges no sales tax ══════════')
{
  const s = await shop('rates-zero-t58', { taxRate: '0', exciseTaxRate: '0' })
  const co = await s.api('GET', '/api/company')
  const body = co.json ?? {}
  // '0' is stored, so it is not a default — and the till must honour it rather than reaching for 8.75%.
  check('a stored 0 is not treated as unset', body.taxRateIsDefault === false, { taxRateIsDefault: body.taxRateIsDefault })
  check('…and the effective rate is 0', near(Number(body.effectiveTaxRate), 0), { effectiveTaxRate: body.effectiveTaxRate })
  const sold = await sellAndRead(s)
  check('…and the sale is charged no tax at all', near(Number(sold.row.total_tax) || 0, 0),
    { totalTax: sold.row.total_tax, salesTax: sold.row.sales_tax, exciseTax: sold.row.excise_tax })
}

// ══════════ 4. the derived values are read-only ════════════════════════════════════════════════════
console.log('\n══════════ the effective rates are derived, not settable ══════════')
{
  const s = await shop('rates-ro-t58', { taxRate: '5', exciseTaxRate: '10' })
  const put = await s.api('PUT', '/api/company', { effectiveTaxRate: 99, effectiveExciseTaxRate: 99 })
  check('sending an effective rate does not error the save', put.status === 200 || put.status === 400,
    { status: put.status, body: put.text?.slice(0, 220) })
  const co = await s.api('GET', '/api/company')
  check('…and the real rate is untouched', near(Number(co.json?.effectiveTaxRate), 5), { effectiveTaxRate: co.json?.effectiveTaxRate })
  const stored: any = ((await db.execute(sql`SELECT tax_rate FROM company WHERE id = ${s.co.id}`) as any).rows || [])[0] || {}
  check('…and so is the column', Number(stored.tax_rate) === 5, { tax_rate: stored.tax_rate })

  // Setting the real field still works, and the effective value follows it.
  const real = await s.api('PUT', '/api/company', { taxRate: 7.5 })
  check('setting the real rate is accepted', real.status === 200, { status: real.status, body: real.text?.slice(0, 220) })
  const after = await s.api('GET', '/api/company')
  check('…and the effective rate follows it', near(Number(after.json?.effectiveTaxRate), 7.5), { effectiveTaxRate: after.json?.effectiveTaxRate })
  check('…and it is no longer a default', after.json?.taxRateIsDefault === false, { taxRateIsDefault: after.json?.taxRateIsDefault })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
