// Items 6 and 8 of the field-service depth brief: the reports that cut the money and the selling by PERSON
// (server/data/teamReports.ts, mounted at /api/team-revenue and /api/plan-reports). Through the real server and
// database, on BOTH field service and basic. Nothing leaves the building.
//   · revenue per tech: invoice → job → who is on it — a job named on the invoice, or the job the quote it was billed
//     from became (deposit / progress / final bills); drafts and voids are out; collected is the payment ledger, net of
//     refunds; "no one on the job" and "not on a job" are their own rows and the rows add up to the Reports page's total;
//   · quote conversion per rep (who wrote it) and per tech (who is on the job it became), the Reports page's definition;
//     a quote made before the app recorded the writer is "not recorded", not given to someone;
//   · plans: sold by person (recorded when made), renewals due in 30/60 days (manual ones flagged), churned plans
//     (cancelled — with the reason — and expired, both stamped; an older ended plan is dated by its last change and says so);
//   · the doors: reports:read only (a Staff or Viewer seat is refused), closed while the features are not ready.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const json = async (r: Response) => (await r.json()) as any
const DAY = 86_400_000
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const FEATURES = ['contacts', 'jobs', 'quotes', 'invoices', 'reports', 'service_agreements', 'team_revenue_reports', 'plan_reports']

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let companyId = ''
    let owner: (p: string, init?: any) => Promise<Response>
    const seat: Record<string, (p: string, init?: any) => Promise<Response>> = {}
    const id: Record<string, string> = {}
    const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
    const row = (rows: any[], name: string) => rows.find((r) => r.person?.name === name)
    let n = 0
    const invoice = (over: any) => ins(t.schema.invoice, { companyId, number: `INV-${++n}`, status: 'sent', contactId: id.ann, subtotal: String(over.total), ...over, total: String(over.total) })
    const pay = (invoiceId: string, amount: number) => ins(t.schema.payment, { invoiceId, amount: String(amount), method: 'cash', paidAt: new Date() })

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      companyId = s.company.id
      await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
      await features(FEATURES)
      const login = async (e: string, p: string) => (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } }))).accessToken
      const as = (tok: string) => (p: string, init: any = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
      owner = as(await login('owner@test.example', s.password))
      for (const role of ['manager', 'field', 'viewer'] as const) {
        const u = await ins(t.schema.user, { email: `${role}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: role === 'manager' ? 'Mona' : role, lastName: 'Seat', role, companyId })
        id[role] = u.id
        seat[role] = as(await login(`${role}@test.example`, 'Seat-pass-1'))
      }
      id.owner = (await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'owner@test.example')))[0].id
      id.ann = (await ins(t.schema.contact, { companyId, type: 'client', name: 'Ann Able', email: 'ann@example.com' })).id
      id.tia = (await ins(t.schema.user, { email: 'tia@test.example', passwordHash: 'x', firstName: 'Tia', lastName: 'Tech', role: 'field', companyId })).id
      id.rob = (await ins(t.schema.teamMember, { companyId, name: 'Rob Roster' })).id
    })

    describe('revenue per tech', () => {
      test('rows by person, the two buckets, quote-chain bills, drafts and voids out, refunds netted — and they add up', async () => {
        const job = (over: any) => ins(t.schema.job, { companyId, number: `RJ-${++n}`, title: 'Visit', contactId: id.ann, ...over })
        const j1 = await job({ assignedToId: id.tia })
        const j2 = await job({ assignedToMemberId: id.rob })
        const j3 = await job({})
        // A quote that became a job Tia is on; the bills made from it carry the quote, not the job.
        const q = await ins(t.schema.quote, { companyId, number: `RQ-${++n}`, contactId: id.ann, status: 'approved', name: 'Quote', total: '300', subtotal: '300' })
        await job({ assignedToId: id.tia, quoteId: q.id })
        const i1 = await invoice({ total: 100, jobId: j1.id })
        const i2 = await invoice({ total: 200, jobId: j2.id })
        await invoice({ total: 50, jobId: j3.id })
        await invoice({ total: 25 })
        const i5 = await invoice({ total: 300, billedQuoteId: q.id, billKind: 'final' })
        await invoice({ total: 999, status: 'draft', jobId: j1.id })
        await invoice({ total: 888, status: 'void', jobId: j1.id })
        await pay(i1.id, 100); await pay(i2.id, 80); await pay(i5.id, 300); await pay(i5.id, -50)

        const r = await json(await owner('/api/team-revenue/by-tech'))
        expect(row(r.rows, 'Tia Tech')).toMatchObject({ bucket: 'person', invoiced: 400, invoiceCount: 2, collected: 350 })
        expect(row(r.rows, 'Rob Roster')).toMatchObject({ bucket: 'person', invoiced: 200, collected: 80 })
        expect(r.rows.find((x: any) => x.bucket === 'unassigned')).toMatchObject({ invoiced: 50, collected: 0 })
        expect(r.rows.find((x: any) => x.bucket === 'no_job')).toMatchObject({ invoiced: 25, collected: 0 })
        expect(r.totals).toMatchObject({ invoiced: 675, invoiceCount: 5, collected: 430 })
        // …and it is the Reports page's own number for the same period.
        const page = await json(await owner('/api/reports/revenue'))
        expect(Number(page.invoiced ?? page.totalInvoiced ?? page.invoices?.total)).toBe(r.totals.invoiced)
        expect(Number(page.collected ?? page.totalCollected)).toBe(r.totals.collected)
      })

      test('a period that holds none of it is empty; a bad date is a plain refusal', async () => {
        const r = await json(await owner('/api/team-revenue/by-tech?startDate=2001-01-01&endDate=2001-01-31'))
        expect(r.rows).toEqual([]); expect(r.totals.invoiced).toBe(0)
        expect((await owner('/api/team-revenue/by-tech?startDate=nope')).status).toBe(400)
        expect((await owner('/api/team-revenue/by-tech?startDate=2026-02-01&endDate=2026-01-01')).status).toBe(400)
      })
    })

    describe('quote conversion', () => {
      test('the server records who wrote a quote', async () => {
        const made = await json(await seat.manager('/api/quotes', { method: 'POST', json: { contactId: id.ann, name: 'Tune-up quote', lineItems: [{ description: 'Tune-up', quantity: 1, unitPrice: 120 }] } }))
        expect(made.id).toBeTruthy()
        const [stored] = await t.db.select().from(t.schema.quote).where(eq(t.schema.quote.id, made.id))
        expect(stored.createdById).toBe(id.manager)
      })

      test('per rep and per tech: approved ÷ decided, open ones are not misses, unknown writers are not guessed', async () => {
        await t.db.delete(t.schema.quote).where(eq(t.schema.quote.companyId, companyId))
        const q = (over: any) => ins(t.schema.quote, { companyId, number: `CQ-${++n}`, name: 'Quote', contactId: id.ann, total: '100', subtotal: '100', ...over })
        const jobFor = (quoteId: string, who: any) => ins(t.schema.job, { companyId, number: `CJ-${++n}`, title: 'Work', contactId: id.ann, quoteId, ...who })
        const a1 = await q({ createdById: id.owner, status: 'approved', total: '400' })
        const ownerId = id.owner
        const a2 = await q({ createdById: ownerId, status: 'approved', total: '200' })
        await q({ createdById: ownerId, status: 'rejected' })
        await q({ createdById: id.manager, status: 'sent' })
        const old = await q({ status: 'approved', total: '50' })
        const lost = await q({ createdById: ownerId, status: 'expired' })
        await jobFor(a1.id, { assignedToId: id.tia })
        await jobFor(a2.id, { assignedToId: id.tia })
        await jobFor(lost.id, { assignedToMemberId: id.rob })

        const w = await json(await owner('/api/team-revenue/quote-conversion'))
        const me = w.rows.find((r: any) => r.person?.id === ownerId)
        expect(me).toMatchObject({ sent: 4, approved: 2, declined: 2, open: 0, approvedValue: 600, conversionRate: 50 })
        expect(w.rows.find((r: any) => r.person?.id === id.manager)).toMatchObject({ sent: 1, approved: 0, open: 1, conversionRate: 0 })
        expect(w.rows.find((r: any) => r.bucket === 'not_recorded')).toMatchObject({ sent: 1, approved: 1, approvedValue: 50 })
        expect(old.createdById).toBeNull()

        const tc = await json(await owner('/api/team-revenue/quote-conversion?by=tech'))
        expect(tc.by).toBe('tech')
        expect(row(tc.rows, 'Tia Tech')).toMatchObject({ sent: 2, approved: 2, conversionRate: 100, approvedValue: 600 })
        expect(row(tc.rows, 'Rob Roster')).toMatchObject({ sent: 1, approved: 0, declined: 1, conversionRate: 0 })
        // Quotes that never became a job have nobody on them.
        expect(tc.rows.find((r: any) => r.bucket === 'not_recorded')).toMatchObject({ sent: 3 })
      })
    })

    describe('service plans', () => {
      let p1 = '', p2 = '', p3 = ''
      const make = async (call: any, name: string, body: any) => (await json(await call('/api/agreements', { method: 'POST', json: { contactId: id.ann, name, startDate: ymd(Date.now() - 100 * DAY), ...body } }))).id as string

      test('who sold it is recorded, and sales are counted per person with their yearly value', async () => {
        p1 = await make(owner, 'Furnace club', { amount: 600, billingFrequency: 'annual', endDate: ymd(Date.now() + 10 * DAY), renewalType: 'manual' })
        p2 = await make(seat.manager, 'AC club', { amount: 50, billingFrequency: 'monthly', endDate: ymd(Date.now() + 45 * DAY), renewalType: 'auto' })
        p3 = await make(owner, 'Duct club', { amount: 300, billingFrequency: 'annual', endDate: ymd(Date.now() + 200 * DAY), renewalType: 'auto' })
        expect([p1, p2, p3].every(Boolean)).toBe(true)
        await ins(t.schema.serviceAgreement, { companyId, contactId: id.ann, number: 'AGR-OLD', name: 'Before 0041', amount: '100', billingFrequency: 'annual', startDate: new Date(Date.now() - 400 * DAY), endDate: new Date(Date.now() + 20 * DAY), status: 'active' })
        const r = await json(await owner('/api/plan-reports/sold'))
        expect(r.rows.find((x: any) => x.person?.id === id.owner)).toMatchObject({ sold: 2, yearlyValue: 900, stillActive: 2 })
        expect(r.rows.find((x: any) => x.person?.id === id.manager)).toMatchObject({ sold: 1, yearlyValue: 600 })
        expect(r.rows.find((x: any) => x.bucket === 'not_recorded')).toMatchObject({ sold: 1, yearlyValue: 100 })
      })

      test('renewals due: 30 and 60 days; manual ones are the ones that need a person', async () => {
        const r30 = await json(await owner('/api/plan-reports/renewals?days=30'))
        expect(r30.rows.map((x: any) => x.name).sort()).toEqual(['Before 0041', 'Furnace club'])
        expect(r30.needsAction).toBe(1)
        expect(r30.rows.find((x: any) => x.name === 'Furnace club')).toMatchObject({ renewal: 'manual', customer: 'Ann Able', yearlyValue: 600 })
        const r60 = await json(await owner('/api/plan-reports/renewals?days=60'))
        expect(r60.rows.map((x: any) => x.name).sort()).toEqual(['AC club', 'Before 0041', 'Furnace club'])
        expect(r60.rows.find((x: any) => x.name === 'AC club')).toMatchObject({ renewal: 'auto', yearlyValue: 600 })
        expect((await owner('/api/plan-reports/renewals?days=45')).status).toBe(400)
      })

      test('churned: a cancelled plan keeps its reason and day; one that ran out is stamped; an older one says its day is approximate', async () => {
        expect((await owner(`/api/agreements/${p3}/cancel`, { method: 'POST', json: { reason: 'Moved away' } })).status).toBe(200)
        const [cancelled] = await t.db.select().from(t.schema.serviceAgreement).where(eq(t.schema.serviceAgreement.id, p3))
        expect(cancelled).toMatchObject({ status: 'cancelled', endedHow: 'cancelled', cancelReason: 'Moved away' })
        expect(cancelled.endedAt).toBeTruthy()

        // A manual plan whose term has run out is expired by the nightly pass, and stamped.
        const lapsed = await make(owner, 'Gutter club', { amount: 240, billingFrequency: 'annual', endDate: ymd(Date.now() + 5 * DAY), renewalType: 'manual' })
        await t.db.update(t.schema.serviceAgreement).set({ endDate: new Date(Date.now() - 3 * DAY) } as any).where(eq(t.schema.serviceAgreement.id, lapsed))
        await (t.services as any).crm.agreements.processDueAgreements()
        const [exp] = await t.db.select().from(t.schema.serviceAgreement).where(eq(t.schema.serviceAgreement.id, lapsed))
        expect(exp).toMatchObject({ status: 'expired', endedHow: 'expired' })
        expect(exp.endedAt).toBeTruthy()

        // One that ended before the app stamped anything: dated by its last change, and it says so.
        await ins(t.schema.serviceAgreement, { companyId, contactId: id.ann, number: 'AGR-GONE', name: 'Old cancelled', amount: '120', billingFrequency: 'annual', startDate: new Date(Date.now() - 500 * DAY), endDate: new Date(Date.now() - 100 * DAY), status: 'cancelled' })

        const r = await json(await owner('/api/plan-reports/churned'))
        const byName = (name: string) => r.rows.find((x: any) => x.name === name)
        expect(byName('Duct club')).toMatchObject({ how: 'cancelled', reason: 'Moved away', dateKnown: true, customer: 'Ann Able', yearlyValue: 300 })
        expect(byName('Duct club').soldBy).toMatchObject({ kind: 'user' })
        expect(byName('Gutter club')).toMatchObject({ how: 'expired', dateKnown: true })
        expect(byName('Old cancelled')).toMatchObject({ how: 'cancelled', dateKnown: false, reason: null })
        // A plan still running is not churn.
        expect(byName('Furnace club')).toBeUndefined()
      })
    })

    describe('the doors', () => {
      const doors = ['/api/team-revenue/by-tech', '/api/team-revenue/quote-conversion', '/api/plan-reports/sold', '/api/plan-reports/renewals', '/api/plan-reports/churned']

      test('a manager reads them; a Staff or Viewer seat is refused by the server', async () => {
        for (const d of doors) {
          expect((await seat.manager(d)).status).toBe(200)
          expect((await seat.field(d)).status).toBe(403)
          expect((await seat.viewer(d)).status).toBe(403)
          expect((await t.call(d)).status).toBe(401)
        }
      })

      test('not ready: closed to a business that does not have the features', async () => {
        await features(FEATURES.filter((f) => f !== 'team_revenue_reports' && f !== 'plan_reports'))
        try {
          for (const d of doors) expect([403, 404]).toContain((await owner(d)).status)
        } finally { await features(FEATURES) }
      })
    })
  })
}
