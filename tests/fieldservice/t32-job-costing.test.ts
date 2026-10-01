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

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
