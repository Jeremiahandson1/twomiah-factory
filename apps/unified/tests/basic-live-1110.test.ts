// The basic (Other) live test (Chrome, 2026-11-10), through the real server as basic:
//   · there was no Sales rep seat, and a Staff login standing in for the rep could not open Quotes — basic now has field service's
//     Sales rep (every customer, their own quotes), and the rep who sold the quote earns without the job being assigned to them;
//   · Reports › Work in progress said "Billed $0.00" for a job billed in full by an invoice made from its quote.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tok: Record<string, string> = {}
const PASS = 'Long-enough-pass-1'
const call = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any)
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
let repId = '', hank = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'basic' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'team', 'lead_inbox', 'dashboard', 'commission_tracking', 'wip_report', 'reports'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tok.owner = (await login('owner@test.example', s.password)).accessToken
  const made = await json(await call('owner', '/api/company/users', { method: 'POST', json: { email: 'rep@basic.example', firstName: 'Rae', lastName: 'Rep', role: 'sales_rep', password: PASS } }))
  expect(made.status).toBe(201)
  repId = made.body.id ?? made.body.user?.id
  tok.rep = (await login('rep@basic.example', PASS)).accessToken
  hank = (await ins(t.schema.contact, { companyId, name: 'Hank Homeowner', email: 'hank@home.example', type: 'client' })).id
}, 120_000)

test("basic has a Sales rep: their word, every customer, their own quotes", async () => {
  const me = await login('rep@basic.example', PASS)
  expect(me.user.roleLabel).toBe('Sales rep')
  for (const p of ['quotes:create', 'contacts:read-all', 'leads:read']) expect(me.permissions).toContain(p)
  for (const p of ['quotes:read-all', 'invoices:read']) expect(me.permissions).not.toContain(p)
  expect((await json(await call('rep', '/api/contacts'))).body.data.map((c: any) => c.name)).toContain('Hank Homeowner')
  await call('owner', '/api/quotes', { method: 'POST', json: { contactId: hank, name: "The office's quote", taxRate: 0, lineItems: [{ description: 'Gutters', quantity: 1, unitPrice: 200 }] } })
  const q = await json(await call('rep', '/api/quotes', { method: 'POST', json: { contactId: hank, name: 'Windows', taxRate: 0, lineItems: [{ description: 'Exterior windows', quantity: 1, unitPrice: 425 }] } }))
  expect(q.status).toBe(201)
  expect((await json(await call('rep', '/api/quotes'))).body.data.map((x: any) => x.name)).toEqual(['Windows'])
})

test('the rep who sold the quote earns when its invoice is paid — the job need not be theirs', async () => {
  const plan = await json(await call('owner', '/api/commissions/plans', { method: 'POST', json: { name: 'Sales rep plan', planType: 'percent_of_invoice', percentRate: 10, autoEarn: 'quote_salesperson' } }))
  expect(plan.status).toBe(201)
  const q = await ins(t.schema.quote, { companyId, contactId: hank, number: 'QTE-00901', name: 'Gutters', status: 'approved', approvedAt: new Date(), subtotal: '200', total: '200', createdById: repId })
  const inv = await ins(t.schema.invoice, { companyId, contactId: hank, quoteId: q.id, number: 'INV-00901', status: 'paid', paidAt: new Date(), subtotal: '200', total: '200', amountPaid: '200', issueDate: new Date() })
  await (t.services as any).crm.earnCommission(inv.id)
  const rows = await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, inv.id)) as any[]
  expect(rows.map((r) => [r.userId, Number(r.commissionAmount), r.source])).toEqual([[repId, 20, 'auto']])
})

test('Work in progress counts an invoice made from the job\'s quote as that job\'s billing', async () => {
  const q = await ins(t.schema.quote, { companyId, contactId: hank, number: 'QTE-00902', name: 'Exterior package', status: 'approved', approvedAt: new Date(), subtotal: '425', total: '425' })
  const job = await ins(t.schema.job, { companyId, contactId: hank, number: 'JOB-00902', title: 'Exterior package', status: 'scheduled', quoteId: q.id })
  await ins(t.schema.invoice, { companyId, contactId: hank, quoteId: q.id, number: 'INV-00902', status: 'paid', paidAt: new Date(), subtotal: '425', total: '425', amountPaid: '425', issueDate: new Date() })
  const wip = await json(await call('owner', '/api/wip'))
  expect(wip.status).toBe(200)
  const row = (wip.body.rows ?? wip.body.data ?? []).find((r: any) => r.id === job.id)
  expect(row?.billed).toBe(425)
})
