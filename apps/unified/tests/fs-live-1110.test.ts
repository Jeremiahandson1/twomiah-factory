// The field service live test (Chrome, 2026-11-09): there was no way to make a Sales rep; a plan's Sold by earned nothing; Agreements ›
// Upcoming Visits dropped today's plan visit after 6 PM in Eau Claire; a warranty or a plan could not name the furnace, so its portal card
// read "Warranty unknown" (and "Last serviced" a day ahead); the office job page said "No notes yet." beside the tech's own log; a booking's
// city and ZIP went nowhere; an approved Good/Better/Best quote's table did not add up; a .md was refused under "text files"; a text
// reminder blamed an empty wallet on a business that never turned texting on. Through the real server as field service.
import { test, expect, beforeAll, afterEach, setSystemTime } from 'bun:test'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { ALLOWED_MIMES } from '../../../packages/tenant-backend/src/files/storage.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tok: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Long-enough-pass-1'
const call = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any)
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
let hank = '', bea = '', furnace = '', planId = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'team', 'lead_inbox', 'dashboard', 'service_agreements', 'maintenance_contracts', 'warranties', 'equipment_tracking', 'commission_tracking', 'client_portal'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tok.owner = (await login('owner@test.example', s.password)).accessToken
  const made = await json(await call('owner', '/api/company/users', { method: 'POST', json: { email: 'rep@heating.example', firstName: 'Sam', lastName: 'Seller', role: 'sales_rep', password: PASS } }))
  expect([made.status, made.body.role ?? made.body.user?.role]).toEqual([201, 'sales_rep'])
  ids.rep = made.body.id ?? made.body.user?.id
  tok.rep = (await login('rep@heating.example', PASS)).accessToken
  hank = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Hank Homeowner', email: 'hank@home.example', type: 'client', portalEnabled: true, portalToken: 'hank-portal' } as any).returning()) as any[])[0].id
  bea = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Bea Neighbor', type: 'client' } as any).returning()) as any[])[0].id
  furnace = ((await t.db.insert(t.schema.equipment).values({ companyId, contactId: hank, name: 'Gas Furnace', manufacturer: 'Carrier', model: '59TN6' } as any).returning()) as any[])[0].id
  planId = ((await t.db.insert(t.schema.agreementPlan).values({ companyId, name: 'Annual Furnace Care', price: '199', billingFrequency: 'annual', durationMonths: 12, visitsIncluded: 0 } as any).returning()) as any[])[0].id
}, 120_000)
afterEach(() => setSystemTime())

test('a Sales rep: its word, its own quotes, and it can sell a maintenance plan', async () => {
  const me = await login('rep@heating.example', PASS)
  expect(me.user.roleLabel).toBe('Sales rep')
  for (const p of ['quotes:create', 'leads:read', 'agreements:create']) expect(me.permissions).toContain(p)
  for (const p of ['quotes:read-all', 'leads:read-all']) expect(me.permissions).not.toContain(p)
  expect((await json(await call('rep', '/api/auth/permissions'))).body.role).toBe('field')
  const q = await json(await call('rep', '/api/quotes', { method: 'POST', json: { contactId: hank, name: 'New furnace', taxRate: 0, lineItems: [{ description: 'Furnace', quantity: 1, unitPrice: 4600 }] } }))
  expect(q.status).toBe(201)
  const a = await json(await call('rep', '/api/agreements', { method: 'POST', json: { contactId: hank, planId, startDate: '2026-11-09' } }))
  expect(a.status).toBe(201)
  expect(a.body.soldById).toBe(ids.rep)
})

test("a plan's Sold by earns the seller's plan when the plan's invoice is paid", async () => {
  const plan = await json(await call('owner', '/api/commissions/plans', { method: 'POST', json: { name: 'Plan sales 10%', planType: 'percent_of_invoice', percentRate: 10, autoEarn: 'quote_salesperson' } }))
  expect(plan.status).toBe(201)
  const [agr] = await t.db.insert(t.schema.serviceAgreement).values({ companyId, contactId: hank, planId, number: 'AGR-0901', name: 'Annual Furnace Care', amount: '199', startDate: new Date(), soldById: ids.rep } as any).returning() as any[]
  const [inv] = await t.db.insert(t.schema.invoice).values({ companyId, contactId: hank, serviceAgreementId: agr.id, number: 'INV-00901', status: 'paid', paidAt: new Date(), subtotal: '199', total: '199', amountPaid: '199', issueDate: new Date() } as any).returning() as any[]
  await (t.services as any).crm.earnCommission(inv.id)
  const rows = await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, inv.id)) as any[]
  expect(rows.map((r) => [r.userId, Number(r.commissionAmount), r.source])).toEqual([[ids.rep, 19.9, 'auto']])
  expect(rows[0].notes).toContain('AGR-0901')
})

test("Upcoming Visits keeps today's visit after 6 PM on the business's clock (UTC is already tomorrow)", async () => {
  const [agr] = await t.db.insert(t.schema.serviceAgreement).values({ companyId, contactId: hank, planId, number: 'AGR-0902', name: 'Annual Furnace Care', amount: '199', startDate: new Date('2026-11-09T00:00:00Z'), status: 'active' } as any).returning() as any[]
  await t.db.insert(t.schema.job).values({ companyId, contactId: hank, number: 'JOB-00904', title: 'Annual Furnace Care — visit 1 of 2', status: 'scheduled', scheduledDate: new Date('2026-11-09T00:00:00Z'), serviceAgreementId: agr.id } as any)
  setSystemTime(new Date('2026-11-10T01:30:00Z')) // 7:30 PM on 11/9 in Chicago
  const rows = await (t.services as any).crm.agreements.getUpcomingVisits(companyId)
  expect(rows.map((r: any) => r.jobNumber)).toContain('JOB-00904')
})

test("a warranty and a plan name the furnace; the portal reads the furnace's warranty and last service on the business's clock", async () => {
  expect((await json(await call('owner', '/api/warranties', { method: 'POST', json: { contactId: bea, equipmentId: furnace, name: 'Wrong customer' } }))).status).toBe(400)
  const w = await json(await call('owner', '/api/warranties', { method: 'POST', json: { contactId: hank, equipmentId: furnace, name: 'Carrier parts and labor', startDate: '2026-11-09', durationMonths: 12 } }))
  expect([w.status, w.body.equipmentId]).toEqual([201, furnace])
  const a = await json(await call('owner', '/api/agreements', { method: 'POST', json: { contactId: hank, planId, startDate: '2026-11-09', equipmentId: furnace } }))
  expect([a.status, a.body.equipmentId]).toEqual([201, furnace])
  expect((await json(await call('owner', '/api/agreements', { method: 'POST', json: { contactId: bea, planId, startDate: '2026-11-09', equipmentId: furnace } }))).status).toBe(400)
  const units = await json(await t.call('/api/portal/p/hank-portal/equipment'))
  expect(units.status).toBe(200)
  const unit = units.body.find((u: any) => u.id === furnace)
  expect(String(unit.warrantyExpiry).slice(0, 10)).toBe('2027-11-09')
  const portal = src('../../../packages/tenant-ui/src/portal/PortalService.tsx')
  expect(portal).toContain('Last serviced {formatWhen(u.lastServiceDate, company?.timeZone)}')
})

test("the office's notes show the tech's own log; a chosen option's lines are in the quote's table", () => {
  const notes = src('../../../packages/tenant-ui/src/jobs/JobNotesPanel.tsx')
  expect(notes).toContain('From the field')
  expect(notes).toContain('!field.length && <p')
  expect(src('../../../packages/tenant-ui/src/jobs/JobDetailPage.tsx')).toContain('fieldLog={(job as any)?.internalNotes ?? null}')
  expect(src('../../../packages/tenant-ui/src/invoicing/QuoteDetailPage.tsx')).toContain('Chosen option:')
  expect(src('../../../packages/tenant-ui/src/portal/PortalQuotes.tsx')).toContain('Your choice:')
})

test("the booking asks City, State and ZIP; a .md is a text file; texting not turned on is said before the wallet", () => {
  const page = src('../server/booking/pages.ts')
  for (const n of ['name="city"', 'name="state"', 'name="zip" inputmode']) expect(page).toContain(n)
  expect(src('../site/public/scripts/book-flow.ts')).toContain("data.zip = zip() || data.zip || ''")
  expect(ALLOWED_MIMES.all).toContain('text/markdown')
  const sms = src('../../../packages/tenant-backend/src/integrations/sms.ts')
  expect(sms.indexOf("errorMessage: 'Texting is not set up for this business yet")).toBeLessThan(sms.indexOf("errorMessage: 'Messaging paused: usage wallet is empty"))
  expect(sms.indexOf("errorMessage: 'Texting is not set up for this business yet")).toBeGreaterThan(0)
})

test('one menu item for agreements and for inventory; the seller choice in field service words, not the default plan', async () => {
  const fs = (await import('../verticals/fieldservice/settings.ts')).default as any
  expect(fs.screens.navHidden).toEqual(['/crm/maintenance', '/crm/parts'])
  expect(fs.screens.navFeatures['/crm/agreements']).toEqual(['service_agreements', 'maintenance_contracts'])
  expect(fs.screens.commissions).toMatchObject({ quoteSeller: true, quoteSellerNotDefault: true })
  expect(fs.screens.settings.roles.map((r: any) => r.value)).toEqual(['viewer', 'sales_rep', 'field', 'manager', 'admin'])
})
