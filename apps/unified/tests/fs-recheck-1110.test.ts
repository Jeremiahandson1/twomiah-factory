// The field service re-check (Chrome, 2026-11-10), through the real server as field service, with real rows (the first round's test
// read source text for the booking and the portal date, and both were still wrong live):
//   · the Sales rep could not pick Hank anywhere: it read only the customers it made (now every customer, like Jobber's Salesperson);
//   · Upcoming Visits said "No upcoming visits" with yesterday's plan visit never done (now shown as Overdue) and the next one in May;
//   · the portal's "Last serviced" read 11/10 for a visit finished at 6:33 PM on 11/9 in Eau Claire (a zone-less MAX() text);
//   · the booking's City and State reached nothing;
//   · a checklist finished from the job's Checklists left no line in the field log;
//   · the Warranties table said "Project" for a furnace's warranty;
//   · a hand-paid plan beside the automatic one could pay a plan sale twice.
import { test, expect, beforeAll, afterEach, setSystemTime } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { addDays, tzParts } from '@twomiah/tenant-backend'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tok: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Long-enough-pass-1'
const TZ = 'America/Chicago'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const call = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any)
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
let hank = '', furnace = '', planId = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ timezone: TZ, enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'team', 'lead_inbox', 'dashboard', 'service_agreements', 'maintenance_contracts', 'warranties', 'equipment_tracking', 'commission_tracking', 'client_portal', 'online_booking', 'job_checklists'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tok.owner = (await login('owner@test.example', s.password)).accessToken
  const made = await json(await call('owner', '/api/company/users', { method: 'POST', json: { email: 'rep@heating.example', firstName: 'Sam', lastName: 'Seller', role: 'sales_rep', password: PASS } }))
  expect(made.status).toBe(201)
  ids.rep = made.body.id ?? made.body.user?.id
  tok.rep = (await login('rep@heating.example', PASS)).accessToken
  // Added by the office, not the rep.
  hank = (await ins(t.schema.contact, { companyId, name: 'Hank Homeowner', email: 'hank@home.example', type: 'client', portalEnabled: true, portalToken: 'hank-recheck' })).id
  furnace = (await ins(t.schema.equipment, { companyId, contactId: hank, name: 'Gas Furnace', manufacturer: 'Carrier', model: '59TN6' })).id
  planId = (await ins(t.schema.agreementPlan, { companyId, name: 'Annual Furnace Care', price: '199', billingFrequency: 'annual', durationMonths: 12, visitsIncluded: 0 })).id
}, 120_000)
afterEach(() => setSystemTime())

test("the Sales rep finds the office's customer, quotes them and sells them a plan; their quotes stay their own", async () => {
  const me = await login('rep@heating.example', PASS)
  expect(me.permissions).toContain('contacts:read-all')
  for (const p of ['quotes:read-all', 'leads:read-all']) expect(me.permissions).not.toContain(p)
  const list = await json(await call('rep', '/api/contacts'))
  expect(list.status).toBe(200)
  expect(list.body.data.map((c: any) => c.name)).toContain('Hank Homeowner')
  expect((await call('rep', `/api/contacts/${hank}`)).status).toBe(200)
  await call('owner', '/api/quotes', { method: 'POST', json: { contactId: hank, name: "The office's quote", taxRate: 0, lineItems: [{ description: 'Coil', quantity: 1, unitPrice: 900 }] } })
  const q = await json(await call('rep', '/api/quotes', { method: 'POST', json: { contactId: hank, name: 'New furnace', taxRate: 0, lineItems: [{ description: 'Furnace', quantity: 1, unitPrice: 4600 }] } }))
  expect(q.status).toBe(201)
  const quotes = await json(await call('rep', '/api/quotes'))
  expect(quotes.body.data.map((x: any) => x.name)).toEqual(['New furnace'])
  const a = await json(await call('rep', '/api/agreements', { method: 'POST', json: { contactId: hank, planId, startDate: '2026-11-09' } }))
  expect([a.status, a.body.soldById]).toEqual([201, ids.rep])
})

test('Upcoming Visits shows a visit still open from yesterday as Overdue, and a range reaches the one in May', async () => {
  const agr = await ins(t.schema.serviceAgreement, { companyId, contactId: hank, planId, number: 'AGR-0951', name: 'Annual Furnace Care', amount: '199', startDate: new Date('2026-11-09T00:00:00Z'), status: 'active' })
  await ins(t.schema.job, { companyId, contactId: hank, number: 'JOB-00951', title: 'visit 1 of 2', status: 'scheduled', scheduledDate: new Date('2026-11-09T00:00:00Z'), serviceAgreementId: agr.id })
  await ins(t.schema.job, { companyId, contactId: hank, number: 'JOB-00952', title: 'visit 2 of 2', status: 'scheduled', scheduledDate: new Date('2027-05-09T00:00:00Z'), serviceAgreementId: agr.id })
  await ins(t.schema.job, { companyId, contactId: hank, number: 'JOB-00953', title: 'done', status: 'completed', scheduledDate: new Date('2026-11-01T00:00:00Z'), serviceAgreementId: agr.id })
  setSystemTime(new Date('2026-11-10T11:30:00Z')) // 5:30 AM on 11/10 in Chicago
  const soon = await json(await call('owner', '/api/agreements/visits/upcoming'))
  expect(soon.status).toBe(200)
  const mine = soon.body.filter((r: any) => ['JOB-00951', 'JOB-00952', 'JOB-00953'].includes(r.jobNumber))
  expect(mine.map((r: any) => [r.jobNumber, r.overdue])).toEqual([['JOB-00951', true]])
  const year = await json(await call('owner', '/api/agreements/visits/upcoming?days=365'))
  expect(year.body.filter((r: any) => r.jobNumber === 'JOB-00952').map((r: any) => r.overdue)).toEqual([false])
})

test("the portal's Last serviced is the moment itself (with its zone), so it reads 11/9 on the business's clock", async () => {
  await ins(t.schema.job, { companyId, contactId: hank, number: 'JOB-00961', title: 'Tune-up', status: 'completed', equipmentId: furnace, scheduledDate: new Date('2026-11-09T00:00:00Z'), completedAt: new Date('2026-11-10T00:33:00Z') })
  const units = await json(await t.call('/api/portal/p/hank-recheck/equipment'))
  expect(units.status).toBe(200)
  const unit = units.body.find((u: any) => u.id === furnace)
  expect(unit.lastServiceDate).toBe('2026-11-10T00:33:00.000Z')
  expect(new Date(unit.lastServiceDate).toLocaleDateString('en-US', { timeZone: TZ })).toBe('11/9/2026')
})

test("an online booking's City and State reach the new customer, and the booking reads the whole address", async () => {
  expect((await call('owner', '/api/booking/settings', { method: 'PATCH', json: { timezone: TZ, enabled: true, maxDaysOut: 30, leadTimeMinutes: 60 } })).status).toBe(200)
  expect((await call('owner', '/api/booking/services', { method: 'POST', json: { name: 'Furnace tune-up', durationMinutes: 60, slotStepMinutes: 60 } })).status).toBe(201)
  expect((await call('owner', '/api/booking/hours', { method: 'PUT', json: { hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00' })) } })).status).toBe(200)
  const day = addDays(tzParts(new Date(), TZ).date, 3)
  const r = await t.call('/api/book/services/furnace-tune-up', { method: 'POST', json: { name: 'Carl Booker', email: 'carl@home.example', phone: '715-555-0100', address: '88 Oak Ave', city: 'Chippewa Falls', state: 'WI', zip: '54729', date: day, time: '14:00' } })
  expect(r.status).toBe(201)
  const [carl] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'carl@home.example')) as any[]
  expect([carl.address, carl.city, carl.state, carl.zip]).toEqual(['88 Oak Ave', 'Chippewa Falls', 'WI', '54729'])
  const [b] = await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.customerEmail, 'carl@home.example')) as any[]
  expect(b.customerAddress).toBe('88 Oak Ave, Chippewa Falls, WI')
})

test("a checklist finished from the job's Checklists, then signed, leaves its lines in the field log", async () => {
  const tpl = await json(await call('owner', '/api/checklists/templates', { method: 'POST', json: { name: 'Furnace tune-up', fields: [{ label: 'Filter changed', type: 'yes_no', required: true }], requireSignature: true } }))
  expect(tpl.status).toBe(201)
  const job = await ins(t.schema.job, { companyId, contactId: hank, number: 'JOB-00971', title: 'Tune-up', status: 'in_progress', internalNotes: '[Nov 9, 2026, 6:31 PM CST] Tech en route' })
  const sub = await json(await call('owner', `/api/checklists/job/${job.id}/submit`, { method: 'POST', json: { templateId: tpl.body.id, answers: [{ id: tpl.body.fields[0].id, value: 'yes' }] } }))
  expect(sub.status).toBe(201)
  const signed = await call('owner', `/api/checklists/submissions/${sub.body.id}/sign`, { method: 'POST', json: { signature: PNG, signedBy: 'Hank Homeowner', consent: true } })
  expect(signed.status).toBe(200)
  const [after] = await t.db.select({ notes: t.schema.job.internalNotes }).from(t.schema.job).where(eq(t.schema.job.id, job.id)) as any[]
  const lines = String(after.notes).split('\n')
  expect(lines[0]).toBe('[Nov 9, 2026, 6:31 PM CST] Tech en route')
  expect(lines[1]).toMatch(/^\[.+\] Checklist "Furnace tune-up" filled in, needs the customer to sign$/)
  expect(lines[2]).toMatch(/^\[.+\] Checklist "Furnace tune-up" signed by the customer$/)
})

test("the Warranties list names the furnace a warranty covers", async () => {
  const w = await json(await call('owner', '/api/warranties', { method: 'POST', json: { contactId: hank, equipmentId: furnace, name: 'Heat exchanger, 10 years', startDate: '2026-11-09', durationMonths: 120 } }))
  expect(w.status).toBe(201)
  const list = await json(await call('owner', '/api/warranties'))
  const row = list.body.data.find((x: any) => x.id === w.body.id)
  expect(row.equipment).toMatchObject({ name: 'Gas Furnace', model: '59TN6' })
})

test("a plan sale paid by hand is not earned again automatically, and one earned automatically is not recorded again by hand", async () => {
  const hand = await json(await call('owner', '/api/commissions/plans', { method: 'POST', json: { name: 'Sales rep standard', planType: 'percent_of_invoice', percentRate: 5 } }))
  const auto = await json(await call('owner', '/api/commissions/plans', { method: 'POST', json: { name: 'Rep plan sales auto', planType: 'percent_of_invoice', percentRate: 10, autoEarn: 'quote_salesperson' } }))
  expect([hand.status, auto.status]).toEqual([201, 201])
  const agr = await ins(t.schema.serviceAgreement, { companyId, contactId: hank, planId, number: 'AGR-0981', name: 'Annual Furnace Care', amount: '199', startDate: new Date(), soldById: ids.rep })
  const paid = (n: string) => ins(t.schema.invoice, { companyId, contactId: hank, serviceAgreementId: agr.id, number: n, status: 'paid', paidAt: new Date(), subtotal: '199', total: '199', amountPaid: '199', issueDate: new Date() })
  // Paid by hand first: nothing automatic beside it.
  const one = await paid('INV-00981')
  expect((await call('owner', '/api/commissions', { method: 'POST', json: { userId: ids.rep, planId: hand.body.id, invoiceId: one.id } })).status).toBe(201)
  await (t.services as any).crm.earnCommission(one.id)
  const rowsOne = await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, one.id)) as any[]
  expect(rowsOne.map((r) => r.source)).toEqual(['manual'])
  // Earned automatically first: the hand-recorded one is refused.
  const two = await paid('INV-00982')
  await (t.services as any).crm.earnCommission(two.id)
  const again = await json(await call('owner', '/api/commissions', { method: 'POST', json: { userId: ids.rep, planId: hand.body.id, invoiceId: two.id } }))
  expect([again.status, again.body.code]).toEqual([409, 'already_earned'])
})
