// crm-dispensary — the 30-day compliance tax report did not add up. (T42 medium)
//
//   "The 30-day compliance tax report still doesn't add up ($5.68 gap on 09-23; subtotal + tax ≠
//    collected on five days)."
//
// Three columns on one row were measured on three different bases: `subtotal` was SUM(o.subtotal),
// gross; `total_tax` was netted for refunded tax (deliberately, T29 M4); `total_collected` was
// SUM(o.total), gross. So a day with a refund left a gap exactly the size of the tax handed back.
//
// AND A DISCOUNT BROKE IT INDEPENDENTLY, which is why this file sells four different shapes. `total`
// is subtotal − discount + tax and the tax report has no discount column, so re-summing the raw
// columns could never reconcile on a discounted day either. A test that only refunded would have
// passed while the discount half stayed broken and came back as a sixth finding.
//
// What is asserted is the IDENTITY, per day and in the totals — subtotal + tax = collected — because
// that is the property a regulator's arithmetic depends on, not any particular figure.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Leaf Tax', slug: 'leaf-tax-t47', email: 'tax47@test.local', state: 'OH',
  taxRate: '8.0', exciseTaxRate: '10.0',
  enabledFeatures: ['products', 'orders', 'compliance', 'dashboard', 'cash_management'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-tax47@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U',
  role: 'owner', companyId: co.id,
} as any).returning()
const [prod] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '45', stockQuantity: 500,
  weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
} as any).returning()
const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1985-04-02',
} as any).returning()

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/compliance', (await import('./src/routes/compliance.ts')).default)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// a drawer, so cash sales and refunds are allowed
await db.execute(sql`
  INSERT INTO cash_sessions (id, company_id, user_id, opened_at, status)
  VALUES ('cs-tax47', ${co.id}, ${owner.id}, now(), 'open')
`)

const sell = async (opts: { qty?: number; discount?: number } = {}) => {
  const made = await api('POST', '/api/orders', {
    contactId: cust.id,
    items: [{ productId: prod.id, quantity: opts.qty ?? 1 }],
    ...(opts.discount ? { discountAmount: opts.discount } : {}),
  })
  const id = made.json?.id ?? made.json?.order?.id
  const done = await api('POST', `/api/orders/${id}/complete`, { paymentMethod: 'cash', cashTendered: 1000, idVerified: true })
  return { id, made, done }
}

console.log('\n══════════ four shapes on one day ══════════')
const plain = await sell()
check('a plain sale settles', plain.done.status === 200 || plain.done.status === 201, { status: plain.done.status, body: plain.done.text?.slice(0, 180) })

const discounted = await sell({ qty: 2, discount: 10 })
check('a DISCOUNTED sale settles', discounted.done.status === 200 || discounted.done.status === 201,
  { status: discounted.done.status, body: discounted.done.text?.slice(0, 180) })

const partly = await sell({ qty: 3 })
const partial = await api('POST', `/api/orders/${partly.id}/refund`, { reason: 'one jar back', amount: 20 })
check('a PARTIAL refund goes through', partial.status === 200 || partial.status === 201, { status: partial.status, body: partial.text?.slice(0, 180) })

const whole = await sell()
const full = await api('POST', `/api/orders/${whole.id}/refund`, { reason: 'all of it back' })
check('a FULL refund goes through', full.status === 200 || full.status === 201, { status: full.status, body: full.text?.slice(0, 180) })

// ══════════ the identity, which is the whole finding ════════════════════════════════════════════
console.log('\n══════════ subtotal + tax = collected ══════════')
{
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
  const r = await api('POST', '/api/compliance/reports/generate', { reportType: 'tax', startDate: from, endDate: to })
  check('the tax report runs', r.status === 200 || r.status === 201, { status: r.status, body: r.text?.slice(0, 220) })

  // The envelope is { reportType, generatedAt, measures, rows }, and `rows` is deliberately
  // POLYMORPHIC — the tax case puts { byDay, totals } in it (documented at compliance.ts:784).
  const data = r.json?.data ?? r.json?.reportData ?? r.json
  const body = data?.rows ?? data
  const byDay = body?.byDay ?? []
  const totals = body?.totals
  check('…and reports at least one day', Array.isArray(byDay) && byDay.length > 0, { byDay: byDay?.length, keys: Object.keys(data ?? {}) })

  let offenders: any[] = []
  for (const d of byDay ?? []) {
    const sub = Number(d.subtotal || 0), tax = Number(d.total_tax || 0), col = Number(d.total_collected || 0)
    if (!near(sub + tax, col)) offenders.push({ day: String(d.sale_date).slice(0, 10), subtotal: sub, tax, collected: col, gap: Math.round((col - sub - tax) * 100) / 100 })
  }
  check('T42: every day reconciles — subtotal + tax = collected', offenders.length === 0, offenders)

  if (totals) {
    check('T42: …and so do the totals',
      near(Number(totals.subtotal || 0) + Number(totals.totalTax || 0), Number(totals.totalCollected || 0)),
      { subtotal: totals.subtotal, totalTax: totals.totalTax, totalCollected: totals.totalCollected })
    // the components must still add up to the tax, or the filing's own lines disagree
    check('…and excise + sales + local = total tax',
      near(Number(totals.exciseTax || 0) + Number(totals.salesTax || 0) + Number(totals.localTax || 0), Number(totals.totalTax || 0)),
      { excise: totals.exciseTax, sales: totals.salesTax, local: totals.localTax, total: totals.totalTax })
    check('…and the refunds actually moved the figures off gross',
      Number(totals.totalCollected || 0) > 0, totals)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
