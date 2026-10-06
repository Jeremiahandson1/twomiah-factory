// crm-dispensary — the tax lines must add up to the tax total, on data where the old split could not.
//
//   "Dispensary: $5.68 tax gap on 09-23." — still open after T42, T47, T51, T53 and T54.
//
// WHY FIVE ROUNDS DID NOT CLOSE IT, which is the point of this file.
//
// t47-tax-report-reconciles.test.ts already asserts "excise + sales + local = total tax", and it has
// passed every round. It could not fail: every refund it makes goes through the refund endpoint, which
// splits the returned tax with the same assessTax that charged it — so refunded_excise_tax can never
// exceed excise_tax, and the per-component GREATEST(0, charged − refunded) floor never bites. The
// fixture was incapable of producing the one shape that breaks additivity, so a green suite kept
// reporting a fault the owner could see on screen.
//
// A real tenant has those rows. A rate corrected after a sale, a refund split by a rate that has since
// changed, an order written straight into the database by an integration: any of them can return more
// of one component than that component was charged. Then the component floors at zero while total_tax
// keeps the whole deduction, the parts come out LARGER than the whole, and the derived local line
// absorbs the difference — $5.68 of it.
//
// So this file plants those rows the way they really arise (an order written by the register, its tax
// columns then rewritten) and asserts the INVARIANT on every tax surface:
//
//   excise + sales + local = total tax     exactly, per day and in every total
//   0 ≤ each component ≤ total tax         no line negative, none larger than the whole
//
// It also measures what the OLD formula would have produced on the same rows, so the file proves it is
// exercising the bug rather than asserting a property that was never at risk. And a second company with
// only ordinary sales proves the fix does not shave a penny off correct data — a money fix that makes
// the invariant hold by under-reporting would pass every assertion above.
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
const near = (a: number, b: number) => Math.abs(a - b) < 0.005
const r2 = (n: number) => Math.round(n * 100) / 100

await setupSchema()

const mkCompany = async (slug: string, name: string) => {
  const [co] = await db.insert(company).values({
    name, slug, email: `${slug}@test.local`, state: 'OH',
    taxRate: '8.0', exciseTaxRate: '10.0', localTaxRate: '0',
    enabledFeatures: ['products', 'orders', 'compliance', 'dashboard', 'cash_management', 'tax_filing', 'reports'],
  } as any).returning()
  const [owner] = await db.insert(user).values({
    email: `owner-${slug}@test.local`, passwordHash: 'x', firstName: 'O', lastName: 'U',
    role: 'owner', companyId: co.id,
  } as any).returning()
  const [prod] = await db.insert(product).values({
    name: 'OG Kush', companyId: co.id, category: 'flower', price: '45', stockQuantity: 500,
    weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const [cust] = await db.insert(contact).values({
    type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1985-04-02',
  } as any).returning()
  await db.execute(sql`
    INSERT INTO cash_sessions (id, company_id, user_id, opened_at, status)
    VALUES (${`cs-${slug}`}, ${co.id}, ${owner.id}, now(), 'open')
  `)
  return { co, owner, prod, cust }
}

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/compliance', (await import('./src/routes/compliance.ts')).default)
app.route('/api/tax-filing', (await import('./src/routes/tax-filing.ts')).default)

const call = (who: string) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

const dirty = await mkCompany('leaf-split-t58', 'Leaf Split')
const clean = await mkCompany('leaf-clean-t58', 'Leaf Clean')
const api = call(dirty.owner.id)
const apiClean = call(clean.owner.id)

const sell = async (c: typeof dirty, who: ReturnType<typeof call>, qty = 1) => {
  const made = await who('POST', '/api/orders', { contactId: c.cust.id, items: [{ productId: c.prod.id, quantity: qty }] })
  const id = made.json?.id ?? made.json?.order?.id
  const done = await who('POST', `/api/orders/${id}/complete`, { paymentMethod: 'cash', cashTendered: 2000, idVerified: true })
  return { id, made, done }
}

// ══════════ the rows ═══════════════════════════════════════════════════════════════════════════════
console.log('\n══════════ three sales, two of them with tax columns a real tenant can produce ══════════')

const a = await sell(dirty, api)       // left exactly as the register wrote it
const b = await sell(dirty, api)       // one component returned beyond what it was charged
const cOrd = await sell(dirty, api)    // total tax mostly returned, components untouched
for (const [label, o] of [['A', a], ['B', b], ['C', cOrd]] as const) {
  check(`sale ${label} settles`, o.done.status === 200 || o.done.status === 201, { status: o.done.status, body: o.done.text?.slice(0, 180) })
}

// What the register actually charged on A, read back rather than assumed — the control value below has
// to be the real one, not one this test computes from a rate it hopes is configured.
const chargedRow: any = (await db.execute(sql`
  SELECT total_tax, excise_tax, sales_tax FROM orders WHERE id = ${a.id}
`) as any).rows?.[0] || {}
const chargedExcise = Number(chargedRow.excise_tax) || 0
const chargedSales = Number(chargedRow.sales_tax) || 0
const chargedTotal = Number(chargedRow.total_tax) || 0
check('A was charged both taxes, so it is a meaningful control', chargedExcise > 0 && chargedSales > 0 && near(chargedExcise + chargedSales, chargedTotal),
  { chargedExcise, chargedSales, chargedTotal })

// B: the refund handed back MORE excise than the sale was charged — a rate corrected after the fact.
// The whole of the tax went back, so B owes nothing: every component must read 0.
await db.execute(sql`
  UPDATE orders
  SET status = 'partially_refunded',
      refunded_amount = '30.00',
      total_tax = '5.00', refunded_tax = '5.00',
      excise_tax = '1.00', refunded_excise_tax = '5.00',
      sales_tax = '4.00', refunded_sales_tax = '0.00'
  WHERE id = ${b.id}
`)

// C: most of the tax went back but the component columns record none of it — the legacy shape, a refund
// written before the per-component columns existed. C kept 3.00 of tax, so its lines must total 3.00
// however the 15.00 of charges were split.
await db.execute(sql`
  UPDATE orders
  SET status = 'partially_refunded',
      refunded_amount = '40.00',
      total_tax = '15.00', refunded_tax = '12.00',
      excise_tax = '10.00', refunded_excise_tax = '0.00',
      sales_tax = '5.00', refunded_sales_tax = '0.00'
  WHERE id = ${cOrd.id}
`)

// ══════════ proof this file exercises the bug ══════════════════════════════════════════════════════
console.log('\n══════════ what the OLD formula produced on these same rows ══════════')
{
  // The superseded arithmetic, run here deliberately: each component floored on its own, the residual
  // clamped at the SUM level. If this still added up, the rows above would not reach the defect and
  // every assertion below would be decoration.
  const old: any = (await db.execute(sql`
    SELECT
      COALESCE(SUM(GREATEST(0, COALESCE(NULLIF(total_tax, '')::numeric, 0) - COALESCE(NULLIF(refunded_tax, '')::numeric, 0))), 0) AS tot,
      COALESCE(SUM(GREATEST(0, COALESCE(NULLIF(excise_tax, '')::numeric, 0) - COALESCE(NULLIF(refunded_excise_tax, '')::numeric, 0))), 0) AS exc,
      COALESCE(SUM(GREATEST(0, COALESCE(NULLIF(sales_tax, '')::numeric, 0) - COALESCE(NULLIF(refunded_sales_tax, '')::numeric, 0))), 0) AS sal
    FROM orders
    WHERE company_id = ${dirty.co.id} AND status IN ('completed', 'partially_refunded')
  `) as any).rows?.[0] || {}
  const oldTot = Number(old.tot) || 0, oldExc = Number(old.exc) || 0, oldSal = Number(old.sal) || 0
  const oldLocal = Math.max(0, r2(oldTot - oldExc - oldSal))
  const oldGap = r2(oldExc + oldSal + oldLocal - oldTot)
  check('the old split did NOT add up on these rows, so the fault is reachable here', Math.abs(oldGap) > 0.005,
    { oldTotal: oldTot, oldExcise: oldExc, oldSales: oldSal, oldLocal, gap: oldGap })
  console.log(`       the old formula was out by $${Math.abs(oldGap).toFixed(2)} on this company`)
}

// ══════════ surface 1: the compliance tax report, per day ══════════════════════════════════════════
console.log('\n══════════ compliance tax report ══════════')
const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
{
  const r = await api('POST', '/api/compliance/reports/generate', { reportType: 'tax', startDate: from, endDate: to })
  check('the tax report runs', r.status === 200 || r.status === 201, { status: r.status, body: r.text?.slice(0, 260) })
  const data = r.json?.data ?? r.json?.reportData ?? r.json
  const body = data?.rows ?? data
  const byDay = body?.byDay ?? []
  const totals = body?.totals
  check('…and reports at least one day', Array.isArray(byDay) && byDay.length > 0, { byDay: byDay?.length, keys: Object.keys(data ?? {}) })

  const offenders: any[] = []
  const overs: any[] = []
  const negatives: any[] = []
  for (const d of byDay ?? []) {
    const tot = Number(d.total_tax || 0)
    const exc = Number(d.excise_tax || 0), sal = Number(d.sales_tax || 0), loc = Number(d.local_tax || 0)
    const day = String(d.sale_date).slice(0, 10)
    if (!near(exc + sal + loc, tot)) offenders.push({ day, excise: exc, sales: sal, local: loc, total: tot, gap: r2(exc + sal + loc - tot) })
    for (const [k, v] of [['excise', exc], ['sales', sal], ['local', loc]] as [string, number][]) {
      if (v > tot + 0.005) overs.push({ day, line: k, value: v, total: tot })
      if (v < -0.005) negatives.push({ day, line: k, value: v })
    }
  }
  check('every day: excise + sales + local = total tax', offenders.length === 0, offenders)
  check('…no single line exceeds the day total', overs.length === 0, overs)
  check('…and no line is negative', negatives.length === 0, negatives)

  check('the totals add up too', !!totals && near(Number(totals.exciseTax || 0) + Number(totals.salesTax || 0) + Number(totals.localTax || 0), Number(totals.totalTax || 0)),
    totals && { excise: totals.exciseTax, sales: totals.salesTax, local: totals.localTax, total: totals.totalTax })
  // The identity T42 fixed must survive this change.
  check('T42 still holds: subtotal + tax = collected', !!totals && near(Number(totals.subtotal || 0) + Number(totals.totalTax || 0), Number(totals.totalCollected || 0)),
    totals && { subtotal: totals.subtotal, totalTax: totals.totalTax, collected: totals.totalCollected })
  // A + B + C: A keeps what it was charged, B keeps nothing, C keeps 3.00.
  check('the total tax kept is A plus nothing plus 3.00', !!totals && near(Number(totals.totalTax || 0), r2(chargedTotal + 3)),
    totals && { reported: totals.totalTax, expected: r2(chargedTotal + 3) })
}

// ══════════ surface 2 and 3: the two tax-filing summaries ══════════════════════════════════════════
console.log('\n══════════ tax filing summaries ══════════')
{
  const s = await api('GET', '/api/tax-filing/summary')
  check('GET /summary answers', s.status === 200, { status: s.status, body: s.text?.slice(0, 260) })
  const b = s.json ?? {}
  check('…it reports the breakdown as reconciling', b.reconciles === true, { reconciles: b.reconciles, variance: b.breakdownVariance, note: b.breakdownNote })
  check('…with a variance of exactly zero', near(Number(b.breakdownVariance || 0), 0), { breakdownVariance: b.breakdownVariance })
  check('…and no alarm note', b.breakdownNote == null, { note: b.breakdownNote })
  const rows: any[] = Array.isArray(b.breakdown) ? b.breakdown : []
  check('…three breakdown lines', rows.length === 3, rows.map((x) => x.id))
  const sumRows = r2(rows.reduce((t, x) => t + (Number(x.collected) || 0), 0))
  check('…the lines sum to the total collected', near(sumRows, Number(b.totalCollected || 0)), { sumRows, totalCollected: b.totalCollected })
  const tooBig = rows.filter((x) => (Number(x.collected) || 0) > Number(b.totalCollected || 0) + 0.005)
  check('…and no line exceeds the total', tooBig.length === 0, tooBig)

  const fs = await api('GET', '/api/tax-filing/filings/summary')
  check('GET /filings/summary answers', fs.status === 200, { status: fs.status, body: fs.text?.slice(0, 260) })
  const f = fs.json ?? {}
  const parts = r2((Number(f.exciseCollectedYTD) || 0) + (Number(f.salesCollectedYTD) || 0))
  check('…excise + sales never exceeds the total collected', parts <= (Number(f.totalCollectedYTD) || 0) + 0.005,
    { excise: f.exciseCollectedYTD, sales: f.salesCollectedYTD, total: f.totalCollectedYTD })
  check('…and the two summaries agree on what was collected', near(Number(f.totalCollectedYTD || 0), Number(b.totalCollected || 0)),
    { filingsSummary: f.totalCollectedYTD, summary: b.totalCollected })
}

// ══════════ surface 4: the return itself ═══════════════════════════════════════════════════════════
console.log('\n══════════ a generated return ══════════')
{
  const gen = await api('POST', '/api/tax-filing/filings/generate', { type: 'combined', period: 'monthly', startDate: from, endDate: to })
  check('a combined return generates', gen.status === 200 || gen.status === 201, { status: gen.status, body: gen.text?.slice(0, 300) })
  const fd = gen.json?.filing_data ?? gen.json?.filingData ?? {}
  const due = Number(gen.json?.total_tax_due ?? gen.json?.totalAmount ?? 0)
  const collected = Number(gen.json?.total_tax_collected ?? 0)
  check('the tax it declares does not exceed the tax that was collected', due <= collected + 0.005, { due, collected })
  check('…and its components add to what it declares',
    near(r2((Number(fd.exciseTaxDue) || 0) + (Number(fd.salesTaxDue) || 0) + (Number(fd.localTaxDue) || 0)), due),
    { excise: fd.exciseTaxDue, sales: fd.salesTaxDue, local: fd.localTaxDue, due })
}

// ══════════ the control: correct data is untouched ═════════════════════════════════════════════════
console.log('\n══════════ a company with only ordinary sales ══════════')
{
  const only = await sell(clean, apiClean)
  check('the clean sale settles', only.done.status === 200 || only.done.status === 201, { status: only.done.status, body: only.done.text?.slice(0, 180) })
  const row: any = (await db.execute(sql`
    SELECT total_tax, excise_tax, sales_tax FROM orders WHERE id = ${only.id}
  `) as any).rows?.[0] || {}

  const r = await apiClean('POST', '/api/compliance/reports/generate', { reportType: 'tax', startDate: from, endDate: to })
  const data = r.json?.data ?? r.json?.reportData ?? r.json
  const totals = (data?.rows ?? data)?.totals
  // Not merely "it adds up" — the exact figures the register charged. A cascade that made the invariant
  // hold by trimming a correct component would satisfy every assertion above and be a worse bug than
  // the one it replaced.
  check('excise is exactly what was charged', !!totals && near(Number(totals.exciseTax || 0), Number(row.excise_tax) || 0),
    { reported: totals?.exciseTax, charged: row.excise_tax })
  check('sales tax is exactly what was charged', !!totals && near(Number(totals.salesTax || 0), Number(row.sales_tax) || 0),
    { reported: totals?.salesTax, charged: row.sales_tax })
  check('local tax is zero, because nothing else was charged', !!totals && near(Number(totals.localTax || 0), 0), { local: totals?.localTax })
  check('and the total matches the charge', !!totals && near(Number(totals.totalTax || 0), Number(row.total_tax) || 0),
    { reported: totals?.totalTax, charged: row.total_tax })
  check('the dirty company did not leak into it', !!totals && Number(totals.orderCount || 0) === 1, { orderCount: totals?.orderCount })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
