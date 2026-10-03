// T32 B3, the clone side.
//
// crm-basic, crm-fieldservice and crm-landscaping shipped a BYTE-IDENTICAL copy of
// services/jobCosting.ts, so they shipped a byte-identical copy of every fault in it. They now run
// the same single implementation as the base CRM — which is only safe if it works WITHOUT accounts
// payable, because `vendor_bill` exists in templates/crm and nowhere else.
//
// So this asserts the thing the base-CRM suite cannot: the bill component is absent rather than
// broken, the endpoints answer, and the revenue and labour fixes hold with no AP table in the
// schema at all. Without it, `vendorBillTable ?? null` is an untested branch in three templates.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const cents = (n: unknown) => Math.round(Number(n || 0) * 100)
const isMoney = (actual: unknown, expected: number) => cents(actual) === cents(expected)

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const schema: any = await import('./db/schema.ts')
const { company, user, contact, project, quote, invoice, job, timeEntry, expense } = schema

check('this template really has no vendor_bill table — the branch under test is the live one',
  schema.vendorBill === undefined, Object.keys(schema).filter((k) => /vendorBill/i.test(k)))

const [co] = await db.insert(company).values({
  name: 'FS Costing', slug: 'fs-costing', email: 'fsc@test.local', state: 'OH', settings: {},
  enabledFeatures: ['job_costing', 'time_tracking', 'expenses'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-fsc@test.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Reed',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [tech] = await db.insert(user).values({
  email: 'tech-fsc@test.local', passwordHash: 'x', firstName: 'Tam', lastName: 'Lee',
  role: 'field', companyId: co.id, isActive: true, hourlyRate: '41.50',
} as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Beechwood Flats', type: 'customer' } as any).returning()
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'Boiler Replacements', number: 'PRJ-FSC-1', status: 'active',
} as any).returning()
const [q2] = await db.insert(quote).values({
  companyId: co.id, contactId: client.id, projectId: proj.id, number: 'QT-FS2', name: 'Unit 2',
  status: 'approved', subtotal: '1800.00', total: '1800.00',
} as any).returning()

const DONE = new Date('2026-09-20T14:00:00Z')
const mkJob = async (number: string, opts: Record<string, unknown> = {}) => (await db.insert(job).values({
  companyId: co.id, contactId: client.id, number, title: `Call ${number}`,
  status: 'completed', completedAt: DONE, projectId: proj.id, ...opts,
} as any).returning())[0]
const j1 = await mkJob('FS-1')
const j2 = await mkJob('FS-2', { quoteId: q2.id })

// A project invoice both jobs share, plus unit 2's own invoice off its quote, plus a draft.
const mkInvoice = async (number: string, subtotal: number, tax: number, status: string, quoteId?: string) =>
  (await db.insert(invoice).values({
    companyId: co.id, contactId: client.id, number, status,
    subtotal: subtotal.toFixed(2), taxAmount: tax.toFixed(2), taxRate: '6.00',
    total: (subtotal + tax).toFixed(2), amountPaid: '0', projectId: proj.id, quoteId: quoteId ?? null,
  } as any).returning())[0]
await mkInvoice('FSI-1', 6000, 360, 'sent')
await mkInvoice('FSI-2', 1800, 108, 'paid', q2.id)
await mkInvoice('FSI-3', 2500, 150, 'draft')

// 8 hours at the tech's own rate = $332.00; the old flat $50 would have said $400.00.
await db.insert(timeEntry).values({
  companyId: co.id, userId: tech.id, jobId: j1.id, hours: '8.00', date: DONE, description: 'Swap unit',
} as any)
await db.insert(expense).values({
  companyId: co.id, jobId: j1.id, date: DONE, category: 'materials', amount: '62.75', description: 'Flue kit',
} as any)

const LABOUR = 332.00, EXPENSES = 62.75, J1_COST = LABOUR + EXPENSES
const ALL_REV = 6000 + 1800

const app = new Hono()
app.route('/api/job-costing', (await import('./src/routes/jobCosting.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

{
  const s = await get('/api/job-costing/summary?limit=100')
  check('the roll-up answers with no AP table present', s.status === 200, { status: s.status, body: s.text?.slice(0, 220) })
  check('…revenue ex-tax, each invoice once, draft excluded', isMoney(s.json?.totals?.invoicedRevenue, ALL_REV),
    { got: s.json?.totals?.invoicedRevenue, expected: ALL_REV, doubleCounted: 6000 * 2 + 1800 })
  const row1 = (s.json?.jobs || []).find((x: any) => x.number === 'FS-1')
  check('…labour at the engineer\'s own rate, not a flat $50', isMoney(row1?.totalCost, J1_COST),
    { got: row1?.totalCost, expected: J1_COST, flatRate: 8 * 50 + EXPENSES })
  check('…and the bill component is zero rather than missing or broken',
    row1?.billedCost === 0, { billedCost: row1?.billedCost })
}
{
  const d = await get(`/api/job-costing/job/${j1.id}`)
  check('the detail answers with no AP table present', d.status === 200, { status: d.status, body: d.text?.slice(0, 220) })
  check('…and agrees with the roll-up to the cent', isMoney(d.json?.actual?.totalCost, J1_COST), d.json?.actual?.totalCost)
  check('…with an empty bill list, not an absent key the screen would crash on',
    Array.isArray(d.json?.billDetail) && d.json.billDetail.length === 0, d.json?.billDetail)
}
{
  const t = await get('/api/job-costing/by-category?groupBy=month')
  check('by month answers', t.status === 200, { status: t.status, body: t.text?.slice(0, 220) })
  const sept = (Array.isArray(t.json) ? t.json : []).find((g: any) => g.key === '2026-09')
  check('…and reconciles with the roll-up above it', isMoney(sept?.revenue, ALL_REV) && isMoney(sept?.cost, J1_COST),
    { revenue: sept?.revenue, cost: sept?.cost })
}

// ══════════ T41 · the estimate had no inputs, which is why margin read 100% ═════════════════════
//
// quote_line_item.type has always been READ here to split the estimate into labour and material,
// and nothing ever WROTE it: the shared quote route's line schema had no `type` field, so every row
// was NULL and both CASE expressions summed to zero. And a line had no cost column at all, so even
// a typed line could only have reported the customer's price back as our cost.
//
// Reported as "pricebook cost never reaches job costing (100% margin)". The deeper truth was worse:
// there was no estimated cost at all on any quoted job in the fleet, and 100% is the margin you get
// when you divide revenue by nothing.
//
// What is pinned: a costed line reaches the estimate at its COST; an uncosted line is counted and
// reported rather than priced at its selling price; and the split follows `type`.
{
  const { quoteLineItem } = schema
  check('T41: quote_line_item carries unit_cost — migration 0024 ran in this sandbox',
    quoteLineItem.unitCost !== undefined, Object.keys(quoteLineItem).filter((k: string) => /cost|pricebook/i.test(k)))

  const [q3] = await db.insert(quote).values({
    companyId: co.id, contactId: client.id, number: 'QT-FS3', name: 'Unit 3 — priced from the book',
    status: 'approved', subtotal: '2000.00', total: '2000.00', taxAmount: '0',
  } as any).returning()
  const j3 = await mkJob('FS-3', { quoteId: q3.id, projectId: null })

  // Sold for 2,000. Costs us 300 of labour + 450 of parts = 750. One line deliberately uncosted.
  await db.insert(quoteLineItem).values([
    { quoteId: q3.id, description: 'Install labour (6h)', quantity: '6.00', unitPrice: '150.00', total: '900.00', sortOrder: 0, type: 'labor', unitCost: '50.00' },
    { quoteId: q3.id, description: 'Condenser unit', quantity: '1.00', unitPrice: '800.00', total: '800.00', sortOrder: 1, type: 'part', unitCost: '450.00' },
    { quoteId: q3.id, description: 'Haulaway — not costed yet', quantity: '1.00', unitPrice: '300.00', total: '300.00', sortOrder: 2, type: 'other' },
  ] as any)

  const one = await get(`/api/job-costing/job/${j3.id}`)
  check('T41: the job cost analysis answers', one.status === 200, { status: one.status, body: one.text?.slice(0, 200) })
  const est = one.json?.estimated

  // THE ASSERTIONS THIS SECTION EXISTS FOR. Each of these read 0 before the fix.
  check('T41: estimated LABOUR cost is 6 × 50 = 300 — the cost, not the 900 it sells for',
    isMoney(est?.laborCost, 300), { laborCost: est?.laborCost })
  check('T41: estimated MATERIAL cost is 1 × 450 = 450, not the 800 it sells for',
    isMoney(est?.materialCost, 450), { materialCost: est?.materialCost })
  check('T41: estimated total cost is 750', isMoney(est?.totalCost, 750), { totalCost: est?.totalCost })

  // 2000 revenue against 750 cost = 1250 profit, 62.5% margin. NOT 100%.
  check('T41: estimated profit is 1250', isMoney(est?.profit, 1250), { profit: est?.profit })
  check('T41: …and the margin is 62.5%, not 100%', Math.abs(Number(est?.margin) - 62.5) < 0.05,
    { margin: est?.margin })

  // The uncosted line is reported, not priced at its selling price and not silently dropped.
  check('T41: the one line with no cost is counted and reported', Number(est?.uncostedLines) === 1,
    { uncostedLines: est?.uncostedLines })
  check('T41: …and its $300 selling price did NOT become a cost', !isMoney(est?.totalCost, 1050),
    { totalCost: est?.totalCost })

  // A quote whose lines are all uncosted must report 0 and say so — not 100% silently.
  const [q4] = await db.insert(quote).values({
    companyId: co.id, contactId: client.id, number: 'QT-FS4', name: 'Unit 4 — never costed',
    status: 'approved', subtotal: '500.00', total: '500.00', taxAmount: '0',
  } as any).returning()
  const j4 = await mkJob('FS-4', { quoteId: q4.id, projectId: null })
  await db.insert(quoteLineItem).values([
    { quoteId: q4.id, description: 'Service call', quantity: '1.00', unitPrice: '500.00', total: '500.00', sortOrder: 0, type: 'labor' },
  ] as any)
  const bare = await get(`/api/job-costing/job/${j4.id}`)
  check('T41: an uncosted quote reports no estimated cost', isMoney(bare.json?.estimated?.totalCost, 0),
    { totalCost: bare.json?.estimated?.totalCost })
  check('T41: …and says SO, so 100% margin is explained rather than implied',
    Number(bare.json?.estimated?.uncostedLines) === 1, { uncostedLines: bare.json?.estimated?.uncostedLines })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
