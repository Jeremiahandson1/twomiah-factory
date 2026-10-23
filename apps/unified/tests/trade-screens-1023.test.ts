// The live tests of 2026-10-22/23 (contractor, landscaping, roofing, home care, HVAC): trade wording and the screens'
// polish, each held by one rule for every vertical. The screens' half of each is clicked in a real browser (see the
// commit); this file holds the rules and the server's half.
//   1. Wording that fits the trade: a contact's page shows only what the vertical has and the business switched on, in
//      the trade's words; every placeholder a vertical can reach is its own.
//   2. A customer picker lists customers: GET /api/contacts?audience=customers; a vendor is never a job's, quote's or
//      invoice's customer.
//   7. New leads: every enquiry nobody has acted on, wherever it waits.
//   8. A margin on no revenue is "—", not 0.0%.
//   9. Only seats that can do the work are given work — jobs, bookings, a roofer's sales rep.
//  10. When an agreement next bills.
//  11. Commissions end to end: a plan names its people, and pays them when the job's invoice is paid.
//  12. Raising pricebook prices by a percent: preview, then all at once, this company's only.
//  13. A job (quote, invoice, warranty job) made under a project is for the project's customer.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'
import { loadVertical } from '../server/core/vertical.ts'
import { getFeaturesForTemplate, mayBeGivenWork as serverMayBeGivenWork, NOT_GIVEN_WORK_ROLES as SERVER_WORKLESS, planPaysPerson } from '@twomiah/tenant-backend'
import { resolveContactsConfig, defaultQuickActions, customersOnly, SECTION_FEATURES, quickActionFeature } from '../../../packages/tenant-ui/src/contacts/types.ts'
import { mayBeGivenWork as screenMayBeGivenWork, NOT_GIVEN_WORK_ROLES as SCREEN_WORKLESS } from '../../../packages/tenant-ui/src/people/work.ts'
import { nextBillOf } from '../../../packages/tenant-ui/src/agreements/types.ts'
import { codeLabel, codesInText, registerCodeWords } from '../../../packages/tenant-ui/src/labels/codes.ts'
// A screen (.tsx): loaded at run time, as this app's server tsconfig compiles no JSX.
const COSTING: string = '../../../packages/tenant-ui/src/reporting/JobCostingPage.tsx'
const { marginOf } = await import(COSTING)

const VERTICALS = ['bar', 'basic', 'contractor', 'fieldservice', 'homecare', 'landscaping', 'restaurant', 'roofing', 'rv', 'salon', 'store', 'vet']
const offered = (v: any, feature: string) => getFeaturesForTemplate(v.featureSet).some((f: any) => f.id === feature)

describe('1. a contact page shows only what the business has, in its words', () => {
  test('a section the vertical has is shown only with its feature on; projects off on a landscaper, quotes off for home care', () => {
    const land = resolveContactsConfig({ sections: { projects: false, quotes: true, sites: true }, hasFeature: (f) => ['quotes', 'jobs', 'invoices'].includes(f) })
    expect(land.shows('projects')).toBe(false)
    expect(land.shows('quotes')).toBe(true)
    expect(land.shows('equipment')).toBe(false)
    // A section the vertical has but the business switched off.
    const off = resolveContactsConfig({ sections: { projects: true, quotes: true }, hasFeature: (f) => f === 'quotes' })
    expect(off.shows('projects')).toBe(false)
    expect(off.shows('invoices')).toBe(false)
    expect(off.shows('jobs')).toBe(false)
    // Quick actions follow the same switches, whatever list the vertical gave (its own list names no feature).
    expect(off.quickActions.map((a) => a.label)).toEqual(['Create Quote'])
    const salonLike = resolveContactsConfig({ quickActions: [{ label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice' }], hasFeature: () => false })
    expect(salonLike.quickActions).toHaveLength(0)
    // No hasFeature handed in (a template not rewired): everything as before.
    expect(resolveContactsConfig({}).shows('projects')).toBe(true)
  })
  test('the job quick action and lists in the trade\'s word; service sites in its word', () => {
    expect(defaultQuickActions('Service Call').map((a) => a.label)).toContain('Schedule Service Call')
    const fs = resolveContactsConfig({ jobLabels: { singular: 'Service Call', plural: 'Service Calls' } })
    expect(fs.quickActions.map((a) => a.label)).toContain('Schedule Service Call')
    expect(fs.jobLabels.plural).toBe('Service Calls')
    expect(resolveContactsConfig({ siteLabels: { singular: 'Property', plural: 'Properties' } }).siteLabels.plural).toBe('Properties')
    expect(resolveContactsConfig({}).siteLabels.plural).toBe('Locations')
  })
  test('no vertical turns on a contact section for a feature it is never offered; the landscaper calls a site a Property', async () => {
    for (const id of VERTICALS) {
      const v: any = await loadVertical(id)
      const sections = v.screens?.contacts?.sections || {}
      for (const [part, on] of Object.entries(sections)) {
        const feature = SECTION_FEATURES[part]
        if (!on || !feature) continue
        expect({ id, part, offered: offered(v, feature) }).toEqual({ id, part, offered: true })
      }
      // A vertical's own quick actions open only pages it is offered.
      for (const a of (v.screens?.contacts?.quickActions || [])) {
        const f = quickActionFeature(a)
        if (f) expect({ id, action: a.label, offered: offered(v, f) }).toEqual({ id, action: a.label, offered: true })
      }
      // Contact types: no Subcontractor where the server refuses one.
      const types = v.crm?.contacts?.types
      if (types) for (const t of (v.screens?.contacts?.types || [])) expect({ id, type: t.value, known: types.includes(t.value) }).toEqual({ id, type: t.value, known: true })
    }
    const land: any = await loadVertical('landscaping')
    expect(land.screens.sites).toMatchObject({ singular: 'Property', plural: 'Properties' })
    const hc: any = await loadVertical('homecare')
    expect(hc.screens.contacts.types.map((t: any) => t.value)).not.toContain('subcontractor')
    expect(hc.screens.leads.platforms.map((p: any) => p.value)).not.toEqual(expect.arrayContaining(['angi']))
  })
  test('every placeholder a vertical can reach is its own, and no other trade\'s', async () => {
    // feature → where its screen reads the trade's example
    const NEEDS: Array<[string, (v: any) => unknown]> = [
      ['pricebook', (v) => v.screens?.pricebook?.namePlaceholder],
      ['flat_rate_pricebook', (v) => v.screens?.pricebook?.codePlaceholder && v.screens?.pricebook?.partsPlaceholder && v.screens?.pricebook?.namePlaceholder],
      ['service_agreements', (v) => v.screens?.agreements?.planNamePlaceholder],
      ['equipment_tracking', (v) => v.screens?.equipment?.placeholders?.name],
      ['warranties', (v) => v.screens?.warranties?.claimTitlePlaceholder],
    ]
    const HVAC = /\b(HVAC|AC|furnace|capacitor|DIAG|filter)\b/i
    for (const id of VERTICALS) {
      const v: any = await loadVertical(id)
      for (const [feature, read] of NEEDS) {
        if (!offered(v, feature)) continue
        expect({ id, feature, set: !!read(v) }).toEqual({ id, feature, set: true })
      }
      // Field service's own Parts page, where the vertical has it (RV hides /crm/parts).
      if (offered(v, 'parts_tracking') && !(v.screens?.navHidden || []).includes('/crm/parts')) {
        expect({ id, parts: !!v.screens?.parts?.namePlaceholder }).toEqual({ id, parts: true })
      }
      if (id === 'fieldservice') continue
      const words = JSON.stringify([v.screens?.pricebook, v.screens?.agreements, v.screens?.parts?.namePlaceholder, v.screens?.equipment?.placeholders, v.screens?.warranties])
      expect({ id, hvac: HVAC.test(words) }).toEqual({ id, hvac: false })
    }
  })
})

describe('9. only a seat that can do the work is given work', () => {
  test('the screens and the server hold one rule', () => {
    expect([...SCREEN_WORKLESS]).toEqual([...SERVER_WORKLESS])
    for (const role of ['owner', 'admin', 'manager', 'field', 'viewer', 'caregiver', '']) for (const isActive of [true, false, null]) {
      expect(screenMayBeGivenWork({ role, isActive })).toBe(serverMayBeGivenWork({ role, isActive }))
    }
    expect(serverMayBeGivenWork({ role: 'viewer', isActive: true })).toBe(false)
    expect(serverMayBeGivenWork({ role: 'field', isActive: false })).toBe(false)
    expect(serverMayBeGivenWork({ role: 'manager', isActive: true })).toBe(true)
  })
})

describe('10. when an agreement next bills — the billing run\'s own rule', () => {
  const now = new Date('2026-10-23T15:00:00Z')
  test('due now, a date, or nothing', () => {
    expect(nextBillOf({ status: 'active', startDate: '2026-10-01', nextBillDate: null }, now)).toEqual({ kind: 'due' })
    expect(nextBillOf({ status: 'active', startDate: '2026-10-01', nextBillDate: '2026-10-20' }, now)).toEqual({ kind: 'due' })
    const later = nextBillOf({ status: 'active', startDate: '2026-10-01', nextBillDate: '2026-11-22T15:00:00Z' }, now)
    expect(later).toEqual({ kind: 'on', date: new Date('2026-11-22T15:00:00Z') })
    // Not started: its first bill is its start.
    expect(nextBillOf({ status: 'active', startDate: '2026-12-01T00:00:00Z' }, now)).toEqual({ kind: 'on', date: new Date('2026-12-01T00:00:00Z') })
    expect(nextBillOf({ status: 'cancelled', startDate: '2026-10-01' }, now)).toEqual({ kind: 'none' })
    expect(nextBillOf({ status: 'active', startDate: '2025-10-01', endDate: '2026-10-01' }, now)).toEqual({ kind: 'none' })
    // The next date falls after the agreement ends: it bills no more.
    expect(nextBillOf({ status: 'active', startDate: '2026-01-01', endDate: '2026-11-01', nextBillDate: '2026-12-01' }, now)).toEqual({ kind: 'none' })
  })
})

describe('raw codes: a stored code is shown in words, the vertical words first', () => {
  test('codeLabel: the vertical, the shared words, then readable; anything not a code as it is', async () => {
    registerCodeWords({})
    expect(codeLabel('in_production')).toBe('In production')
    expect(codeLabel('no_show')).toBe('No-show')
    expect(codeLabel('percent_of_invoice')).toBe('% of invoice')
    expect(codeLabel('CNAME')).toBe('CNAME')
    expect(codeLabel('Spring cleanup')).toBe('Spring cleanup')
    expect(codeLabel(null)).toBe('')
    const roof: any = await loadVertical('roofing')
    registerCodeWords(roof.screens.codeLabels)
    expect(codeLabel('in_production')).toBe('In Production')
    expect(codesInText('Status changed: invoiced → collected')).toBe('Status changed: Invoiced → Collected')
    expect(codesInText('Status changed: material_ordered → in_production')).toBe('Status changed: Material Ordered → In Production')
    expect(codesInText('Called the adjuster')).toBe('Called the adjuster')
    registerCodeWords({})
  })
})

describe('8. a margin on no revenue', () => {
  test('is a dash, never 0.0%', () => {
    expect(marginOf(0, 0)).toBe('—')
    expect(marginOf(86.36, 220)).toBe('86.4%')
    expect(marginOf(-12, 100)).toBe('-12.0%')
  })
})

describe('11. commissions: who a plan pays', () => {
  test('a plan that names people pays only them; a general plan pays anyone who has no plan of their own', () => {
    const pat = { id: 'p1', userIds: ['pat'], isActive: true }
    const general = { id: 'g1', userIds: [], isActive: true }
    const retired = { id: 'r1', userIds: ['sam'], isActive: false }
    const all = [pat, general, retired]
    expect(planPaysPerson(pat, 'pat', all)).toBe(true)
    expect(planPaysPerson(pat, 'sam', all)).toBe(false)
    expect(planPaysPerson(general, 'pat', all)).toBe(false) // Pat has a plan of his own
    expect(planPaysPerson(general, 'sam', all)).toBe(true) // Sam's only plan is retired
    expect(planPaysPerson(general, 'lee', all)).toBe(true)
  })
})

// ── through the real server ──────────────────────────────────────────────────────────────────────────────────────
let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASSWORD = 'Pass-word-1'
let ip = 0
const as = (who: string, method: string, path: string, json?: unknown) =>
  t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
const body = async (r: Response) => { const s = await r.text(); try { return JSON.parse(s) } catch { return s } }
const signIn = async (email: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD }, headers: { 'X-Forwarded-For': `203.0.113.${++ip}` } })).json()).accessToken as string
const FEATURES = ['dashboard', 'contacts', 'projects', 'jobs', 'quotes', 'invoices', 'lead_inbox', 'commission_tracking', 'pricebook', 'online_booking', 'service_agreements', 'warranties', 'team']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const S = t.schema
  const hash = await Bun.password.hash(PASSWORD, 'bcrypt')
  for (const [key, slug] of [['A', 'trade-a'], ['B', 'trade-b']] as const) {
    const [co] = await t.db.insert(S.company).values({ name: `Trade ${key}`, slug, enabledFeatures: FEATURES } as any).returning()
    ids[`co${key}`] = co.id
    const [u] = await t.db.insert(S.user).values({ email: `owner${key.toLowerCase()}@test.example`, passwordHash: hash, firstName: 'O', lastName: key, role: 'owner', companyId: co.id }).returning()
    ids[`owner${key}`] = u.id
    tokens[`owner${key}`] = await signIn(`owner${key.toLowerCase()}@test.example`)
  }
  for (const [key, role, first, active] of [['pat', 'field', 'Pat', true], ['sam', 'field', 'Sam', true], ['vic', 'viewer', 'Vic', true], ['gone', 'field', 'Gone', false]] as const) {
    const [u] = await t.db.insert(S.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: first, lastName: 'A', role, companyId: ids.coA, isActive: active }).returning()
    ids[key] = u.id
  }
  const [client] = await t.db.insert(S.contact).values({ companyId: ids.coA, name: 'Casey Client', type: 'client', email: 'casey@test.example' }).returning()
  const [vendor] = await t.db.insert(S.contact).values({ companyId: ids.coA, name: 'Vera Vendor', type: 'vendor' }).returning()
  ids.client = client.id; ids.vendor = vendor.id
  const [p] = await t.db.insert(S.project).values({ companyId: ids.coA, number: 'PRJ-1', name: 'Kitchen', contactId: client.id }).returning()
  ids.project = p.id
}, 180_000)

describe('2. a customer picker lists customers', () => {
  test('?audience=customers leaves vendors out; an unknown audience is refused', async () => {
    const all = await body(await as('ownerA', 'GET', '/api/contacts?limit=200'))
    expect(all.data.map((c: any) => c.name)).toContain('Vera Vendor')
    const customers = await body(await as('ownerA', 'GET', '/api/contacts?limit=200&audience=customers'))
    expect(customers.data.map((c: any) => c.name)).toContain('Casey Client')
    expect(customers.data.some((c: any) => c.type === 'vendor')).toBe(false)
    expect((await as('ownerA', 'GET', '/api/contacts?audience=everyone')).status).toBe(400)
    expect(customersOnly([{ id: 'a', type: 'vendor' }, { id: 'b', type: 'client' }]).map((c) => c.id)).toEqual(['b'])
    expect(customersOnly([{ id: 'a', type: 'vendor' }], 'a').map((c) => c.id)).toEqual(['a'])
  })
  test('a vendor is never made a job\'s, quote\'s or invoice\'s customer', async () => {
    const line = [{ description: 'Work', quantity: 1, unitPrice: 100 }]
    const q = await as('ownerA', 'POST', '/api/quotes', { name: 'Q', contactId: ids.vendor, lineItems: line })
    expect(q.status).toBe(400)
    expect((await body(q)).code).toBe('vendor_not_client')
    const j = await as('ownerA', 'POST', '/api/jobs', { title: 'J', contactId: ids.vendor })
    expect(j.status).toBe(400)
    expect((await body(j)).code).toBe('vendor_not_client')
    const i = await as('ownerA', 'POST', '/api/invoices', { contactId: ids.vendor, lineItems: line })
    expect(i.status).toBe(400)
    // Another company's contact is not this one's customer.
    expect((await as('ownerB', 'POST', '/api/jobs', { title: 'J', contactId: ids.client })).status).toBe(404)
    // A job already on a vendor (from before) keeps saving as it was.
    const [old] = await t.db.insert(t.schema.job).values({ companyId: ids.coA, number: 'JOB-90001', title: 'Old', contactId: ids.vendor } as any).returning()
    expect((await as('ownerA', 'PUT', `/api/jobs/${old.id}`, { title: 'Old, renamed', contactId: ids.vendor })).status).toBe(200)
  })
})

describe('13. a job, quote or invoice made under a project is for the project\'s customer', () => {
  test('job: created under the project with no customer takes the project\'s', async () => {
    const r = await as('ownerA', 'POST', '/api/jobs', { title: 'Framing', projectId: ids.project })
    expect(r.status).toBe(201)
    const job = await body(r)
    expect(job.contactId).toBe(ids.client)
    const full = await body(await as('ownerA', 'GET', `/api/jobs/${job.id}`))
    expect(full.contact?.name).toBe('Casey Client')
    // A job given a project later, with no customer, takes it too; a customer cleared on purpose stays cleared.
    const bare = await body(await as('ownerA', 'POST', '/api/jobs', { title: 'Loose' }))
    expect(bare.contactId ?? null).toBeNull()
    const moved = await body(await as('ownerA', 'PUT', `/api/jobs/${bare.id}`, { projectId: ids.project }))
    expect(moved.contactId).toBe(ids.client)
    const cleared = await body(await as('ownerA', 'PUT', `/api/jobs/${bare.id}`, { contactId: '' }))
    expect(cleared.contactId ?? null).toBeNull()
    // A job from before the rule (project, no customer) saved from the edit form — which posts back its empty customer —
    // takes the project's: an empty customer it never had clears nothing.
    const [legacy] = await t.db.insert(t.schema.job).values({ companyId: ids.coA, number: 'JOB-90002', title: 'Legacy', projectId: ids.project } as any).returning()
    expect((await body(await as('ownerA', 'PUT', `/api/jobs/${legacy.id}`, { title: 'Legacy, renamed', contactId: '', projectId: ids.project }))).contactId).toBe(ids.client)
    // Another company's project is not this one's.
    expect((await as('ownerB', 'POST', '/api/jobs', { title: 'X', projectId: ids.project })).status).toBe(404)
  })
  test('quote and invoice under the project; a job converted from a customer-less quote', async () => {
    const line = [{ description: 'Cabinets', quantity: 1, unitPrice: 500 }]
    const q = await body(await as('ownerA', 'POST', '/api/quotes', { name: 'Cabinets', projectId: ids.project, lineItems: line }))
    expect(q.contactId).toBe(ids.client)
    const inv = await as('ownerA', 'POST', '/api/invoices', { projectId: ids.project, lineItems: line })
    expect(inv.status).toBe(201)
    expect((await body(inv)).contactId).toBe(ids.client)
    // A quote from before the rule: on the project, no customer. The job made from it is the project customer's.
    const [oldQ] = await t.db.insert(t.schema.quote).values({ companyId: ids.coA, number: 'QTE-90001', name: 'Old', projectId: ids.project, status: 'approved', subtotal: '100', total: '100' } as any).returning()
    const conv = await body(await as('ownerA', 'POST', `/api/quotes/${oldQ.id}/convert-to-job`))
    const jobId = conv.id || conv.job?.id || conv.jobId
    const [made] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, jobId))
    expect(made.contactId).toBe(ids.client)
  })
})

describe('7. new leads: every enquiry nobody has acted on, wherever it waits — and one list of exactly those', () => {
  const stats = async () => body(await as('ownerA', 'GET', '/api/dashboard/stats'))
  const list = async () => body(await as('ownerA', 'GET', '/api/dashboard/new-leads'))
  const names = async () => (await list()).data.map((r: any) => r.name).sort()
  test('inbox enquiries at New and lead contacts with nothing done; no time window; imports left out; the list is the count', async () => {
    expect((await stats()).newLeads).toBe(0)
    // A website enquiry in the Lead Inbox; one already dismissed and one converted do not count.
    await t.db.insert(t.schema.lead).values([
      { companyId: ids.coA, sourcePlatform: 'website', homeownerName: 'Web Walt', status: 'new', receivedAt: new Date() },
      { companyId: ids.coA, sourcePlatform: 'website', homeownerName: 'Dismissed Dora', status: 'dismissed', receivedAt: new Date() },
      { companyId: ids.coA, sourcePlatform: 'website', homeownerName: 'Contacted Carl', status: 'contacted', receivedAt: new Date() },
    ] as any)
    // A lead the owner typed in, and one from long ago — no window: nobody has answered either.
    const typed = await body(await as('ownerA', 'POST', '/api/contacts', { name: 'Phone Phil', type: 'lead' }))
    await t.db.insert(t.schema.contact).values({ companyId: ids.coA, name: 'Old Olga', type: 'lead', createdAt: new Date(Date.now() - 400 * 86400000) } as any)
    // Imported or moved over: left out, however they were marked.
    await t.db.insert(t.schema.contact).values([
      { companyId: ids.coA, name: 'Moved Mo', type: 'lead', source: 'jobber_migration' },
      { companyId: ids.coA, name: 'Invoice Ivy', type: 'lead', source: 'import' },
    ] as any)
    const csv = new FormData()
    csv.append('file', new File(['name,email,type\nCsv Cara,cara@example.com,lead\n'], 'leads.csv', { type: 'text/csv' }))
    const imp = await t.call('/api/import/contacts', { method: 'POST', body: csv, headers: { Authorization: `Bearer ${tokens.ownerA}` } })
    expect(imp.status).toBe(200)
    const [cara] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.name, 'Csv Cara'))
    expect({ type: cara?.type, imported: !!(cara?.customFields as any)?.importedAt }).toEqual({ type: 'lead', imported: true })
    // A client is not a lead.
    await body(await as('ownerA', 'POST', '/api/contacts', { name: 'Client Clem', type: 'client' }))

    let s = await stats()
    expect(s.newLeads).toBe(3)
    expect(s.newLeadsFrom).toEqual({ inbox: 1, contacts: 2 })
    // The one list the tile opens: exactly the rows counted.
    let l = await list()
    expect(l.pagination.total).toBe(3)
    expect(await names()).toEqual(['Old Olga', 'Phone Phil', 'Web Walt'])
    expect(l.data.find((r: any) => r.name === 'Web Walt').kind).toBe('enquiry')
    expect(l.data.find((r: any) => r.name === 'Phone Phil')).toMatchObject({ kind: 'contact', id: typed.id })
    // Quoting the typed-in lead takes it off both.
    await as('ownerA', 'POST', '/api/quotes', { name: 'Fence', contactId: typed.id, lineItems: [{ description: 'Fence', quantity: 1, unitPrice: 900 }] })
    expect((await stats()).newLeads).toBe(2)
    expect(await names()).toEqual(['Old Olga', 'Web Walt'])
    // Converting the old lead into a client takes it off; so does marking the enquiry contacted.
    await as('ownerA', 'POST', `/api/contacts/${(await list()).data.find((r: any) => r.name === 'Old Olga').id}/convert`)
    const walt = (await list()).data.find((r: any) => r.name === 'Web Walt')
    await as('ownerA', 'PUT', `/api/leads/${walt.id}/status`, { status: 'contacted' })
    expect((await stats()).newLeads).toBe(0)
    expect((await list()).data).toEqual([])
    // Another company's caller sees only its own.
    expect((await body(await as('ownerB', 'GET', '/api/dashboard/new-leads'))).pagination.total).toBe(0)
  })
})

describe('9. only a seat that can do the work is given work (server)', () => {
  test('the job picker and online booking leave out the viewer and a switched-off login', async () => {
    const assignable = await body(await as('ownerA', 'GET', '/api/team/assignable'))
    const names = assignable.data.map((p: any) => p.id)
    expect(names).toContain(ids.pat)
    expect(names).not.toContain(ids.vic)
    expect(names).not.toContain(ids.gone)
    const viewer = await as('ownerA', 'POST', '/api/booking/days-off', { date: '2026-12-01', userId: ids.vic })
    expect(viewer.status).toBe(400)
    const field = await as('ownerA', 'POST', '/api/booking/days-off', { date: '2026-12-01', userId: ids.pat })
    expect(field.status).toBe(201)
    // Saving the week keeps a viewer's old window (it never makes them bookable) rather than refusing the save.
    await t.db.insert(t.schema.bookingHours).values({ companyId: ids.coA, userId: ids.vic, dayOfWeek: 1, startMinute: 540, endMinute: 600 } as any)
    const hours = await body(await as('ownerA', 'GET', '/api/booking/hours'))
    const rows = (hours.data || hours).map((h: any) => ({ userId: h.userId, dayOfWeek: h.dayOfWeek, start: '09:00', end: '10:00' }))
    expect((await as('ownerA', 'PUT', '/api/booking/hours', { hours: [...rows, { userId: null, dayOfWeek: 2, start: '09:00', end: '17:00' }] })).status).toBe(200)
  })
})

describe('11. commissions end to end', () => {
  test('a plan names its people; when the job\'s invoice is paid in full, the person on the job earns under their plan', async () => {
    // Who it pays is checked: a stranger, another company's login.
    expect((await as('ownerA', 'POST', '/api/commissions/plans', { name: 'X', planType: 'percent_of_invoice', percentRate: 10, userIds: [ids.ownerB] })).status).toBe(400)
    const patPlan = await body(await as('ownerA', 'POST', '/api/commissions/plans', { name: 'Pat 10%', planType: 'percent_of_invoice', percentRate: 10, autoEarn: 'job_assignee', userIds: [ids.pat] }))
    expect(patPlan.userIds).toEqual([ids.pat])
    const general = await body(await as('ownerA', 'POST', '/api/commissions/plans', { name: 'Crew flat', planType: 'flat_rate', flatRateAmount: 25, autoEarn: 'job_assignee' }))
    const plans = await body(await as('ownerA', 'GET', '/api/commissions/plans'))
    expect(plans.data.find((p: any) => p.id === patPlan.id).userIds).toEqual([ids.pat])

    const sell = async (assignee: string, amount: number) => {
      const q = await body(await as('ownerA', 'POST', '/api/quotes', { name: 'Deck', contactId: ids.client, lineItems: [{ description: 'Deck', quantity: 1, unitPrice: amount }], taxRate: 0 }))
      await as('ownerA', 'POST', `/api/quotes/${q.id}/approve`)
      const job = await body(await as('ownerA', 'POST', `/api/quotes/${q.id}/convert-to-job`))
      const jobId = job.id || job.job?.id
      expect((await as('ownerA', 'PUT', `/api/jobs/${jobId}`, { assignedToId: assignee })).status).toBe(200)
      const inv = await body(await as('ownerA', 'POST', `/api/quotes/${q.id}/convert-to-invoice`))
      const invoiceId = inv.id || inv.invoice?.id
      const paid = await as('ownerA', 'POST', `/api/invoices/${invoiceId}/payments`, { amount, method: 'cash' })
      expect(paid.status).toBe(201)
      // The route earns straight away (afterMoney, not awaited by the reply); the sweep makes it certain.
      await (t.services as any).crm.commissionEarner.earnForInvoice(invoiceId)
      return invoiceId
    }
    const patInvoice = await sell(ids.pat, 1000)
    const samInvoice = await sell(ids.sam, 400)
    const earned = (await body(await as('ownerA', 'GET', '/api/commissions'))).data
    const patRows = earned.filter((r: any) => r.invoiceId === patInvoice)
    const samRows = earned.filter((r: any) => r.invoiceId === samInvoice)
    // Pat: his own plan only (10% of $1,000), never the general one too.
    expect(patRows.map((r: any) => [r.userId, r.planId, Number(r.commissionAmount), r.source])).toEqual([[ids.pat, patPlan.id, 100, 'auto']])
    // Sam has no plan of his own: the general plan pays him.
    expect(samRows.map((r: any) => [r.userId, r.planId, Number(r.commissionAmount)])).toEqual([[ids.sam, general.id, 25]])

    // Recorded by hand: a plan that names people pays only them.
    const notOn = await as('ownerA', 'POST', '/api/commissions', { userId: ids.sam, planId: patPlan.id, baseAmount: 100 })
    expect(notOn.status).toBe(400)
    expect((await body(notOn)).code).toBe('not_on_plan')
    expect((await as('ownerA', 'POST', '/api/commissions', { userId: ids.pat, planId: patPlan.id, baseAmount: 100 })).status).toBe(201)
  })
})

describe('12. raising pricebook prices by a percent', () => {
  test('preview writes nothing; apply raises every price and its tiers, to the cent, in this company only', async () => {
    const a = await body(await as('ownerA', 'POST', '/api/pricebook/items', { name: 'Gutter clean', price: 99.99 }))
    await as('ownerA', 'PUT', `/api/pricebook/items/${a.id}/options`, { options: [{ tier: 'good', name: 'Basic', price: 80, features: [], recommended: false }, { tier: 'best', name: 'Plus', price: 150, features: [], recommended: true }] })
    const b = await body(await as('ownerB', 'POST', '/api/pricebook/items', { name: 'Other company', price: 100 }))
    const req = { adjustmentType: 'percent', adjustmentValue: 10, applyTo: 'price' }
    const preview = await body(await as('ownerA', 'POST', '/api/pricebook/bulk/adjust-prices', { ...req, preview: true }))
    expect(preview.preview).toBe(true)
    const line = preview.items.find((i: any) => i.id === a.id)
    expect([line.from, line.to]).toEqual([99.99, 109.99])
    expect(line.tiers.map((g: any) => [g.tier, g.from, g.to]).sort()).toEqual([['best', 150, 165], ['good', 80, 88]])
    expect(preview.items.some((i: any) => i.id === b.id)).toBe(false)
    expect(Number((await body(await as('ownerA', 'GET', `/api/pricebook/items/${a.id}`))).price)).toBe(99.99) // nothing written
    // Out of bounds, or nothing at all, is refused.
    expect((await as('ownerA', 'POST', '/api/pricebook/bulk/adjust-prices', { ...req, adjustmentValue: 0 })).status).toBe(400)
    expect((await as('ownerA', 'POST', '/api/pricebook/bulk/adjust-prices', { ...req, adjustmentValue: 250 })).status).toBe(400)
    // Another company's item ids are not this company's to change.
    const sneaky = await body(await as('ownerA', 'POST', '/api/pricebook/bulk/adjust-prices', { ...req, itemIds: [b.id] }))
    expect(sneaky.updated).toBe(0)
    const done = await body(await as('ownerA', 'POST', '/api/pricebook/bulk/adjust-prices', req))
    expect(done.updated).toBeGreaterThan(0)
    expect(Number((await body(await as('ownerA', 'GET', `/api/pricebook/items/${a.id}`))).price)).toBe(109.99)
    const opts = await body(await as('ownerA', 'GET', `/api/pricebook/items/${a.id}/options`))
    expect((Array.isArray(opts) ? opts : opts.data).map((o: any) => Number(o.price)).sort((x: number, y: number) => x - y)).toEqual([88, 165])
    expect(Number((await body(await as('ownerB', 'GET', `/api/pricebook/items/${b.id}`))).price)).toBe(100)
  })
})
