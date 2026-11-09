// The landscaping live test (11/08), each finding as it should be now, through the real server as the landscaping vertical:
//   · the crew's own Complete button (/api/tech/:id/complete-job) is held by a required checklist, as every other door is;
//   · the crew's note on Complete is the visit's note to the customer;
//   · Crew Score counts hours logged by hand, and a tap-through (seconds between Arrived and Complete) is not scored;
//   · a route's month invoice credits each visit with its own amount in Job costing, and pays the visit's crew its commission;
//   · a contract is not renewed months before it ends (that replaced the term it was in);
//   · the price book's materials reach the crew by name, never with a price; the lawn company's Crew lead / Crew member seats
//     hold no prices, and a Crew member's menu is their day.
// Nothing reaches a real tenant or the internet.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import landscaping from '../verticals/landscaping/settings.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', crew = '', crewId = ''
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string

const FEATURES = ['contacts', 'jobs', 'quotes', 'invoices', 'tech_mobile_view', 'job_checklists', 'visit_reports', 'recurring_routes', 'crew_day_map', 'visit_skip', 'visit_materials', 'crew_timers', 'job_costing', 'reports', 'commission_tracking', 'pricebook', 'time_tracking', 'service_agreements', 'maintenance_contracts']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  owner = await login('owner@test.example', s.password)
  const password = 'Correct-horse-1'
  crewId = (await ins(t.schema.user, { companyId, email: 'lead@test.example', firstName: 'Lee', lastName: 'Lead', role: 'crew_lead', passwordHash: await Bun.password.hash(password, 'bcrypt') })).id
  crew = await login('lead@test.example', password)
}, 120_000)

async function visit(label: string, extra: Record<string, unknown> = {}) {
  const ct = await ins(t.schema.contact, { companyId, name: `${label} Customer`, type: 'client', email: 'cust@example.com' })
  return ins(t.schema.job, { companyId, number: `JOB-${label}`, title: `Mow ${label}`, status: 'in_progress', contactId: ct.id, assignedToId: crewId, scheduledDate: new Date(), ...extra })
}

test('the crew\'s Complete button is held while a required checklist is unfinished', async () => {
  const made = await json(await post(owner, '/api/checklists/templates', { name: 'Spring cleanup checklist', fields: [{ label: 'Beds edged?', type: 'yes_no', required: true }] }))
  expect(made.status).toBeLessThan(300)
  const j = await visit('Check')
  const refused = await json(await post(crew, `/api/tech/${j.id}/complete-job`, {}))
  expect(refused.status).toBe(400)
  expect(refused.body.error).toContain('Spring cleanup checklist')
  // Filled in (the web field view's form), the same button completes the visit.
  const tpl = made.body.data ?? made.body
  expect((await post(crew, `/api/checklists/job/${j.id}/submit`, { templateId: tpl.id, answers: [{ id: tpl.fields[0].id, value: 'yes' }] })).status).toBeLessThan(300)
  expect((await post(crew, `/api/tech/${j.id}/complete-job`, { notes: 'Edged every bed' })).status).toBe(200)
  await t.db.update(t.schema.formTemplate).set({ active: false } as any).where(eq(t.schema.formTemplate.id, tpl.id))
})

test('what the crew writes on Complete is the visit\'s note to the customer', async () => {
  const j = await visit('Note')
  expect((await post(crew, `/api/tech/${j.id}/complete-job`, { notes: 'Missed nothing; bagged the clippings' })).status).toBe(200)
  const [r] = await t.db.select().from(t.schema.visitReport).where(eq(t.schema.visitReport.jobId, j.id)) as any[]
  expect(r?.note).toBe('Missed nothing; bagged the clippings')
})

test('Crew Score counts hours logged by hand; seconds between Arrived and Complete are not scored', async () => {
  const day = new Date().toISOString().slice(0, 10)
  const logged = await visit('Logged', { status: 'completed', estimatedHours: '0.5', startedAt: new Date(Date.now() - 30_000), completedAt: new Date() })
  await ins(t.schema.timeEntry, { companyId, userId: crewId, jobId: logged.id, hours: '0.75', date: new Date() })
  const rows = (await json(await as(owner, `/api/crew-day/score?from=${day}&to=${day}`))).body.data as any[]
  const lee = rows.find((r) => r.lead === 'Lee Lead')
  expect(lee.actualHours).toBeGreaterThanOrEqual(0.75)
  expect(lee.score).toBeLessThan(100) // 0.5 h allowed over 0.75 h worked — never the 1833 a tap-through gave
})

describe('a route\'s month invoice', () => {
  test('credits each visit with its own amount and pays the visit\'s crew', async () => {
    const plan = await json(await post(owner, '/api/commissions/plans', { name: 'Crew standard', planType: 'percent_of_invoice', percentRate: 10, appliesToRole: 'all', autoEarn: 'job_assignee' }))
    expect(plan.status).toBeLessThan(300)
    const a = await visit('RouteA', { status: 'completed', completedAt: new Date() })
    const b = await visit('RouteB', { status: 'completed', completedAt: new Date() })
    const [inv] = await t.db.insert(t.schema.invoice).values({ companyId, number: 'INV-R1', contactId: a.contactId, status: 'sent', subtotal: '70', total: '70', taxAmount: '0', amountPaid: '0' } as any).returning() as any[]
    await t.db.insert(t.schema.routeVisitInvoice).values([
      { companyId, jobId: a.id, invoiceId: inv.id, amount: '35' },
      { companyId, jobId: b.id, invoiceId: inv.id, amount: '35' },
    ] as any)
    expect((await post(owner, `/api/invoices/${inv.id}/payments`, { amount: 70, method: 'cash' })).status).toBeLessThan(300)
    const cost = (await json(await as(owner, `/api/job-costing/job/${a.id}`))).body
    expect((cost.data ?? cost).actual.revenue).toBe(35)
    const mine = await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, inv.id)) as any[]
    expect(mine.map((c) => [c.userId, Number(c.commissionAmount)])).toEqual([[crewId, 7]])
  })
})

test('a contract is not renewed months before it ends; near its end it is', async () => {
  const ct = await ins(t.schema.contact, { companyId, name: 'Renew Customer', type: 'client' })
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const far = await json(await post(owner, '/api/agreements', { contactId: ct.id, name: 'Weekly mowing', amount: 150, billingFrequency: 'monthly', startDate: ymd(Date.now()), endDate: ymd(Date.now() + 365 * 86_400_000) }))
  expect(far.status).toBeLessThan(300)
  const early = await json(await post(owner, `/api/agreements/${(far.body.data ?? far.body).id}/renew`, {}))
  expect(early.status).toBe(409)
  expect(early.body.error).toContain('can be renewed from')
  const near = await json(await post(owner, '/api/agreements', { contactId: ct.id, name: 'Fall cleanup', amount: 150, billingFrequency: 'monthly', startDate: ymd(Date.now() - 300 * 86_400_000), endDate: ymd(Date.now() + 20 * 86_400_000) }))
  expect((await post(owner, `/api/agreements/${(near.body.data ?? near.body).id}/renew`, {})).status).toBe(200)
})

test('the crew picks materials by name — the catalogue carries no price — and the crew seats hold no prices', async () => {
  await ins(t.schema.pricebookItem, { companyId, name: 'Hardwood mulch', type: 'material', unit: 'yard', price: '45', cost: '20', active: true })
  const list = (await json(await as(crew, '/api/crew-day/materials-catalog'))).body.data as any[]
  const mulch = list.find((x) => x.name === 'Hardwood mulch')
  expect(mulch).toEqual({ id: expect.any(String), name: 'Hardwood mulch', unit: 'yard' })
  // The price list itself answers a crew seat with names and units, no price and no cost (packages/tenant-backend pricebook.ts).
  const book = (await json(await as(crew, '/api/pricebook/items'))).body
  const row = (book.data ?? book).find((x: any) => x.name === 'Hardwood mulch')
  expect(row).toBeTruthy()
  expect(row.price ?? null).toBeNull()
  expect(row.cost ?? null).toBeNull()
  expect(landscaping.roleWithheld).toEqual({ crew_lead: ['prices:read'], crew: ['prices:read'] })
  expect((landscaping.screens as any).navOnlyFor.crew).toEqual(['/crm/dashboard', '/crm/tech', '/crm/time'])
})
