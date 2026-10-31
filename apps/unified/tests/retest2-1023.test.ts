// The owner's second live re-test of 2026-10-23, through the real server (the screens' half is clicked in headless Edge).
//   1/2. A login that holds work is never deleted: deleting the landscaper's "Test Crew" login (to add it again) took
//        JOB-00001's crew off it through job.assigned_to_id's ON DELETE SET NULL, and left the contractor's commission
//        naming nobody ("Former team member"). Deactivate keeps everything; only an unused login is deleted.
//   8.   Takeoffs: a company default markup on cost prices every material with no selling price of its own; the
//        Material prices screen shows the suggestion; the sheet's measured price and its quote price are both named.
//   9.   A maintenance contract sold before its plan's visits were made gets its term's visits, once, at boot.
//   10.  A review request says where it went, and why the other way did not.
//   11.  A whole list with no limit asked reports the server's default page size, never its row count.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'
import { sentSummary } from '../../../packages/tenant-backend/src/integrations/reviews.ts'
import { sellingPrice } from '../server/crm/field/takeoffsService.ts'
import { DEFAULT_PAGE_LIMIT } from '../server/http/reply.ts'

const PASSWORD = 'Pass-word-1'
const body = async (r: Response) => { const s = await r.text(); try { return JSON.parse(s) } catch { return s } }

async function tenant(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const S = t.schema
  const hash = await Bun.password.hash(PASSWORD, 'bcrypt')
  const [co] = await t.db.insert(S.company).values({ name: 'Retest Co', slug: 'retest-' + vertical, enabledFeatures: features, timezone: 'America/Chicago' } as any).returning()
  const [owner] = await t.db.insert(S.user).values({ email: 'owner@test.example', passwordHash: hash, firstName: 'Olive', lastName: 'Owner', role: 'owner', companyId: co.id }).returning()
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: PASSWORD } })).json()).accessToken as string
  const as = (method: string, path: string, json?: unknown) => t.call(path, { method, json, headers: { Authorization: `Bearer ${token}` } })
  return { t, S, co, owner, as }
}

// ── 1 / 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('1/2 · a login that holds work is deactivated, never deleted', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  beforeAll(async () => { x = await tenant('contractor', ['contacts', 'jobs', 'invoices', 'commission_tracking', 'team']) }, 120_000)

  const addLogin = async (email: string, firstName: string) => {
    const r = await x.as('POST', '/api/company/users', { email, firstName, lastName: 'Crew', role: 'field' })
    expect(r.status).toBe(201)
    return (await body(r)).id as string
  }

  test('an invited login with a job assigned is refused (409), says what it holds, and the job keeps its person', async () => {
    const crew = await addLogin('crew@test.example', 'Test')
    // A job is for a customer (crm.jobs.requireCustomer, contractor PR #173).
    const contactId = (await body(await x.as('POST', '/api/contacts', { name: 'Mowing Customer', type: 'client' }))).id
    const job = await body(await x.as('POST', '/api/jobs', { title: 'Weekly mowing', assignedToId: crew, contactId }))
    expect(job.assignedToId).toBe(crew)
    const r = await x.as('DELETE', `/api/company/users/${crew}`)
    expect(r.status).toBe(409)
    const b = await body(r)
    expect(b.code).toBe('user_holds_records')
    expect(b.held).toEqual(['1 job'])
    expect(b.error).toContain('Test Crew still has 1 job')
    expect(b.error).toContain('Deactivate them instead')
    const [row] = await x.t.db.select().from(x.S.job).where(eq(x.S.job.id, job.id))
    expect(row.assignedToId).toBe(crew)
    expect((await x.t.db.select().from(x.S.user).where(eq(x.S.user.id, crew))).length).toBe(1)
  })

  test('a commission (no foreign key) holds its person too — the row never names nobody', async () => {
    const staff = await addLogin('staff@test.example', 'Sam')
    await x.t.db.insert(x.S.commission).values({ companyId: x.co.id, userId: staff, baseAmount: '1650.00', commissionAmount: '165.00' } as any)
    const r = await x.as('DELETE', `/api/company/users/${staff}`)
    expect(r.status).toBe(409)
    expect((await body(r)).held).toEqual(['1 commission'])
    const listed = await body(await x.as('GET', '/api/commissions'))
    expect(listed.data.find((c: any) => c.userId === staff)?.userName).toBe('Sam Crew')
  })

  test('deactivating and reactivating keeps the commission and the job on the same person', async () => {
    const [staff] = await x.t.db.select().from(x.S.user).where(eq(x.S.user.email, 'staff@test.example'))
    expect((await x.as('PUT', `/api/company/users/${staff.id}`, { isActive: false })).status).toBe(200)
    expect((await x.as('PUT', `/api/company/users/${staff.id}`, { isActive: true })).status).toBe(200)
    const listed = await body(await x.as('GET', '/api/commissions'))
    expect(listed.data.find((c: any) => c.userId === staff.id)?.userName).toBe('Sam Crew')
  })

  test('an unused invite with nothing to its name is still deleted (204)', async () => {
    const spare = await addLogin('spare@test.example', 'Spare')
    expect((await x.as('DELETE', `/api/company/users/${spare}`)).status).toBe(204)
    expect((await x.t.db.select().from(x.S.user).where(eq(x.S.user.id, spare))).length).toBe(0)
  })
})

// ── 8 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('8 · takeoffs: a default markup on cost prices what has no selling price of its own', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  let sheetId = '', asm: any
  beforeAll(async () => {
    x = await tenant('contractor', ['contacts', 'projects', 'jobs', 'quotes', 'takeoff_tools'])
    const [client] = await x.t.db.insert(x.S.contact).values({ companyId: x.co.id, name: 'Pat Client', type: 'client' }).returning()
    const [p] = await x.t.db.insert(x.S.project).values({ companyId: x.co.id, number: 'PRJ-1', name: 'Kitchen', contactId: client.id }).returning()
    expect((await x.as('POST', '/api/takeoffs/assemblies/seed', {})).status).toBe(200)
    asm = (await body(await x.as('GET', '/api/takeoffs/assemblies'))).data.find((a: any) => a.name === 'Drywall (1/2")')
    sheetId = (await body(await x.as('POST', `/api/takeoffs/project/${p.id}`, { name: 'Kitchen walls' }))).id
    // 12 × 15 ft of wall: 180 sq ft × 0.03125 sheets × 1.12 waste = 6.3 sheets measured.
    await x.as('POST', `/api/takeoffs/sheets/${sheetId}/items`, { assemblyId: asm.id, length: 12, width: 15, quantity: 1 })
  }, 120_000)

  test('the rule: its own price wins; else cost plus the markup, to the cent; else nothing', () => {
    expect(sellingPrice({ unitCost: 12, unitPrice: 18 }, 25)).toBe(18)
    expect(sellingPrice({ unitCost: 12, unitPrice: 0 }, 25)).toBe(15)
    expect(sellingPrice({ unitCost: '8.00', unitPrice: '0' }, 12.5)).toBe(9)
    expect(sellingPrice({ unitCost: 3.33, unitPrice: 0 }, 10)).toBe(3.66)
    expect(sellingPrice({ unitCost: 12, unitPrice: 0 }, null)).toBe(0)
    expect(sellingPrice({ unitCost: 0, unitPrice: 0 }, 50)).toBe(0)
  })

  test('with no markup the quote lines are unpriced, as before; a markup prices them from cost, and the sheet is worked out again', async () => {
    expect(await body(await x.as('GET', '/api/takeoffs/settings'))).toEqual({ markupPercent: null })
    const before = (await body(await x.as('GET', `/api/takeoffs/sheets/${sheetId}/quote-lines`))).lines
    expect(before.every((l: any) => l.unitPrice === 0)).toBe(true)

    expect((await x.as('PUT', '/api/takeoffs/settings', { markupPercent: -1 })).status).toBe(400)
    expect((await x.as('PUT', '/api/takeoffs/settings', { markupPercent: 5000 })).status).toBe(400)
    expect((await x.as('PUT', '/api/takeoffs/settings', { markupPercent: 'lots' })).status).toBe(400)
    const put = await x.as('PUT', '/api/takeoffs/settings', { markupPercent: 25 })
    expect(put.status).toBe(200)
    expect(await body(put)).toEqual({ markupPercent: 25 })

    const lines = (await body(await x.as('GET', `/api/takeoffs/sheets/${sheetId}/quote-lines`))).lines
    const sheet = lines.find((l: any) => String(l.description).startsWith('1/2" Drywall'))
    expect(sheet).toMatchObject({ quantity: 7, unitPrice: 15, unitCost: 12 })
    // The Material prices screen reads what each comes to.
    const listed = (await body(await x.as('GET', '/api/takeoffs/assemblies'))).data.find((a: any) => a.id === asm.id)
    expect(listed.materials.find((m: any) => m.name === '1/2" Drywall 4x8').sellingPrice).toBe(15)
    // The settings blob is merged, never replaced.
    const [co] = await x.t.db.select().from(x.S.company).where(eq(x.S.company.id, x.co.id))
    expect((co.settings as any).takeoffMarkupPercent).toBe(25)
  })

  test('a selling price set on the material wins over the markup', async () => {
    const mat = asm.materials.find((m: any) => m.name === '1/2" Drywall 4x8')
    expect((await x.as('PUT', `/api/takeoffs/assemblies/${asm.id}`, { materials: [{ id: mat.id, unitPrice: 18 }] })).status).toBe(200)
    const lines = (await body(await x.as('GET', `/api/takeoffs/sheets/${sheetId}/quote-lines`))).lines
    expect(lines.find((l: any) => String(l.description).startsWith('1/2" Drywall')).unitPrice).toBe(18)
    // Screws have no price of their own: still cost + 25%.
    expect(lines.find((l: any) => String(l.description).startsWith('Drywall Screws')).unitPrice).toBe(10)
  })

  test('the totals name both prices: as measured (6.3 sheets) and on a quote (7 whole sheets)', async () => {
    const totals = (await body(await x.as('GET', `/api/takeoffs/sheets/${sheetId}/totals`))).totals
    const lines = (await body(await x.as('GET', `/api/takeoffs/sheets/${sheetId}/quote-lines`))).lines
    const onQuote = Math.round(lines.reduce((s: number, l: any) => s + Math.round(l.quantity * l.unitPrice * 100) / 100, 0) * 100) / 100
    expect(totals.quotePrice).toBe(onQuote)
    expect(totals.quotePrice).toBeGreaterThan(totals.totalPrice)
    // Taking the markup away leaves the material with its own price priced, and the rest unpriced again.
    expect(await body(await x.as('PUT', '/api/takeoffs/settings', { markupPercent: null }))).toEqual({ markupPercent: null })
    const after = (await body(await x.as('GET', `/api/takeoffs/sheets/${sheetId}/quote-lines`))).lines
    expect(after.find((l: any) => String(l.description).startsWith('Drywall Screws')).unitPrice).toBe(0)
    expect(after.find((l: any) => String(l.description).startsWith('1/2" Drywall')).unitPrice).toBe(18)
  })
})

// ── 9 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('9 · an older maintenance contract gets its term\'s visits, once', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  let planId = '', contactId = ''
  const day = (n: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + n))
  const agreement = async (number: string, start: Date, end: Date) => (await x.t.db.insert(x.S.serviceAgreement).values({
    companyId: x.co.id, contactId, planId, number, name: 'Spring & Fall', status: 'active', startDate: start, endDate: end, amount: '300', billingFrequency: 'annual',
  } as any).returning())[0]
  const visits = (agreementId: string) => x.t.db.select().from(x.S.job).where(eq(x.S.job.serviceAgreementId, agreementId))
  const sweep = () => ((x.t.services as any).crm.agreements.scheduleMissingTermVisits as () => Promise<Array<{ agreementId: string; made: number }>>)()

  beforeAll(async () => {
    x = await tenant('landscaping', ['contacts', 'jobs', 'maintenance_contracts', 'service_agreements', 'scheduling'])
    planId = (await body(await x.as('POST', '/api/agreements/plans', { name: 'Spring & Fall', price: 300, billingFrequency: 'annual', visitsIncluded: 2, durationMonths: 12 }))).id
    const [c] = await x.t.db.insert(x.S.contact).values({ companyId: x.co.id, name: 'Carla Customer', type: 'client', address: '100 Oak St' }).returning()
    contactId = c.id
  }, 120_000)

  test('a contract made before the fix (no visit at all) gets both, from today — never booked in the past', async () => {
    const old = await agreement('AGR-00001', day(-90), day(275))
    expect(await visits(old.id)).toHaveLength(0)
    const made = await sweep()
    expect(made).toEqual([{ agreementId: old.id, made: 2 }])
    const rows = (await visits(old.id)).sort((a: any, b: any) => +a.scheduledDate - +b.scheduledDate)
    expect(rows).toHaveLength(2)
    expect(rows.every((r: any) => r.status === 'scheduled')).toBe(true)
    // The company's today (America/Chicago) or later: never a visit booked in the past.
    const chicagoToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    expect(new Date(rows[0].scheduledDate as any).toISOString().slice(0, 10) >= chicagoToday).toBe(true)
    // Next service reads the first of them.
    const listed = (await body(await x.as('GET', '/api/agreements?limit=50'))).data.find((a: any) => a.id === old.id)
    expect(listed).toBeTruthy()
  })

  test('running it again makes nothing (idempotent)', async () => {
    expect(await sweep()).toEqual([])
  })

  test('a term with any visit job — even a cancelled one — is somebody\'s, and is left as it is', async () => {
    const touched = await agreement('AGR-00002', day(-30), day(335))
    await x.t.db.insert(x.S.job).values({ companyId: x.co.id, number: 'JOB-90001', title: 'Cancelled visit', status: 'cancelled', scheduledDate: day(10), contactId, serviceAgreementId: touched.id } as any)
    expect(await sweep()).toEqual([])
    expect(await visits(touched.id)).toHaveLength(1)
  })

  test('a contract that is not active, or whose plan includes no visits, is not touched', async () => {
    const cancelled = await agreement('AGR-00003', day(-30), day(335))
    await x.t.db.update(x.S.serviceAgreement).set({ status: 'cancelled' } as any).where(eq(x.S.serviceAgreement.id, cancelled.id))
    const none = (await body(await x.as('POST', '/api/agreements/plans', { name: 'On call', price: 50, visitsIncluded: 0, durationMonths: 12 }))).id
    const [open] = await x.t.db.insert(x.S.serviceAgreement).values({ companyId: x.co.id, contactId, planId: none, number: 'AGR-00004', name: 'On call', status: 'active', startDate: day(-30), endDate: day(335), amount: '50' } as any).returning()
    expect(await sweep()).toEqual([])
    expect(await visits(cancelled.id)).toHaveLength(0)
    expect(await visits(open.id)).toHaveLength(0)
  })
})

// ── 10 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('10 · a review request says where it went', () => {
  test('the sentence: what went, and why the other did not, in words an owner can act on', () => {
    expect(sentSummary({ email: 'casey@example.com', phone: '715-555-0101' }, { sms: false, email: true }, { sms: "A 'From' or 'MessagingServiceSid' parameter is required to send a message" }))
      .toBe('Review request emailed to casey@example.com. The text was not sent: texting is not set up for this business yet (Settings › Texting).')
    expect(sentSummary({ email: 'a@b.c', phone: '1' }, { sms: true, email: true }, {})).toBe('Review request emailed to a@b.c and texted to 1.')
    expect(sentSummary({ email: null, phone: '715' }, { sms: true, email: false }, {})).toBe('Review request texted to 715.')
  })

  test('through the route: the job\'s customer is emailed, the text is refused, and the reply names both', async () => {
    const x = await tenant('roofing', ['contacts', 'jobs', 'google_reviews'])
    const [c] = await x.t.db.insert(x.S.contact).values({ companyId: x.co.id, name: 'Casey Customer', type: 'client', email: 'casey@example.com', phone: '715-555-0101' }).returning()
    const [j] = await x.t.db.insert(x.S.job).values({ companyId: x.co.id, number: 'ROOF-0001', title: '101 Test St', status: 'collected', contactId: c.id } as any).returning()
    expect((await x.as('PUT', '/api/reviews/settings', { googlePlaceId: 'ChIJtest', reviewRequestEnabled: true })).status).toBeLessThan(300)
    const r = await x.as('POST', `/api/reviews/request/${j.id}`, { channel: 'both' })
    const b = await body(r)
    expect(r.status).toBe(200)
    expect(b.summary).toContain('emailed to casey@example.com')
    expect(b.summary).toContain('The text was not sent')
  }, 120_000)
})

// ── 11 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('11 · a whole list reports the server\'s default page size when none is asked', () => {
  test('services with 2 rows say limit 50, not 2; a limit asked for is kept; more rows than it raise it', async () => {
    const x = await tenant('fieldservice', ['contacts', 'jobs', 'scheduling', 'online_booking', 'gps_tracking'])
    expect(DEFAULT_PAGE_LIMIT).toBe(50)
    for (const name of ['Furnace check', 'AC tune-up']) expect((await x.as('POST', '/api/booking/services', { name, durationMinutes: 60 })).status).toBeLessThan(300)
    const all = await body(await x.as('GET', '/api/booking/services'))
    expect(all.data).toHaveLength(2)
    expect(all.pagination).toEqual({ page: 1, limit: 50, total: 2, pages: 1 })
    expect((await body(await x.as('GET', '/api/booking/services?limit=1'))).pagination).toEqual({ page: 1, limit: 2, total: 2, pages: 1 })
    expect((await body(await x.as('GET', '/api/geofencing'))).pagination).toEqual({ page: 1, limit: 50, total: 0, pages: 0 })
  }, 120_000)
})
