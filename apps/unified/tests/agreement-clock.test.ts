// An agreement's end, renewal and billing on the company's clock; a selection's due day too (2026-10-22 sweep).
// The clock is pinned to the pair that tells the rules apart: 2026-10-23 03:00 UTC is 10pm on the 22nd in Chicago,
// 06:00 UTC is 1am on the 23rd. A term ends as its end DAY begins at the company's midnight (time/zoneDay.ts
// markerDayHasBegun); under the old rule it ended at UTC's, the evening before.
import { describe, test, expect, beforeAll, afterAll, setSystemTime, setDefaultTimeout } from 'bun:test'
import { eq, and } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

setDefaultTimeout(60_000)
type Call = (p: string, init?: any) => Promise<Response>
const json = async (r: Response) => (await r.json()) as any
const EVENING = new Date('2026-10-23T03:00:00Z') // 10pm, 22 Oct, Chicago
const AFTER_MIDNIGHT = new Date('2026-10-23T06:00:00Z') // 1am, 23 Oct, Chicago
const day = (d: any) => new Date(d).toISOString().slice(0, 10)

async function tenant(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, s.company.id))
  let token = '', at = 0
  const owner: Call = async (p, init = {}) => {
    if (!token || Math.abs(Date.now() - at) > 60_000) { token = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken; at = Date.now() }
    return t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  }
  return { t, owner, companyId: s.company.id as string }
}

describe('1 · agreements end and renew at the company’s midnight', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  let autoId: string, manualId: string, contactId: string
  const svc = () => (x.t.services as any).crm.agreements
  const row = async (id: string) => (await x.t.db.select().from(x.t.schema.serviceAgreement).where(eq(x.t.schema.serviceAgreement.id, id)))[0]
  beforeAll(async () => {
    setSystemTime(EVENING)
    x = await tenant('landscaping', ['contacts', 'jobs', 'invoices', 'service_agreements', 'maintenance_contracts'])
    contactId = (await json(await x.owner('/api/contacts', { method: 'POST', json: { name: 'Rene Wal', type: 'client', email: 'rene@test.example' } }))).id
    // Two contracts whose term ends on the 23rd: one renews itself, one waits for the office.
    autoId = (await json(await x.owner('/api/agreements', { method: 'POST', json: { contactId, name: 'Lawn plan', amount: 600, billingFrequency: 'annual', startDate: '2025-10-23', endDate: '2026-10-23', renewalType: 'auto' } }))).id
    manualId = (await json(await x.owner('/api/agreements', { method: 'POST', json: { contactId, name: 'Snow plan', amount: 300, billingFrequency: 'annual', startDate: '2025-10-23', endDate: '2026-10-23', renewalType: 'manual' } }))).id
  })
  afterAll(() => { setSystemTime() })

  test('10pm on the 22nd in Chicago: both still run their term — nothing renewed, nothing expired', async () => {
    setSystemTime(EVENING)
    await svc().processDueAgreements()
    const [a, m] = [await row(autoId), await row(manualId)]
    expect([day(a.endDate), a.status, day(m.endDate), m.status]).toEqual(['2026-10-23', 'active', '2026-10-23', 'active'])
    // …and the list counts them as ending soon, not ended.
    const list = await json(await x.owner('/api/agreements?status=active'))
    expect(list.data.map((r: any) => r.id).sort()).toEqual([autoId, manualId].sort())
  })

  test('1am on the 23rd: the auto one renews for a term, once, however many runs; the manual one expires', async () => {
    setSystemTime(AFTER_MIDNIGHT)
    // Two runs at the same moment (the 12-hourly worker and a page read), then another.
    await Promise.all([svc().processDueAgreements(), svc().processDueAgreements()])
    await svc().processDueAgreements()
    await x.owner('/api/agreements?status=active') // a read settles too
    const [a, m] = [await row(autoId), await row(manualId)]
    expect([day(a.startDate), day(a.endDate), a.status]).toEqual(['2026-10-23', '2027-10-23', 'active'])
    expect(m.status).toBe('expired')
    const renewals = await x.t.db.select().from(x.t.schema.auditLog).where(and(eq(x.t.schema.auditLog.entityId, autoId), eq(x.t.schema.auditLog.action, 'renew')))
    expect(renewals.length).toBe(1)
  })

  test('across the switch: a contract the old UTC rule already renewed tonight is not renewed again', async () => {
    // As the UTC rule left it at 10pm Chicago: term 23 Oct 2026 → 23 Oct 2027, already active.
    setSystemTime(EVENING)
    const early = (await json(await x.owner('/api/agreements', { method: 'POST', json: { contactId, name: 'Hedge plan', amount: 120, billingFrequency: 'annual', startDate: '2026-10-23', endDate: '2027-10-23', renewalType: 'auto' } }))).id
    for (const at of [EVENING, AFTER_MIDNIGHT]) { setSystemTime(at); await svc().processDueAgreements() }
    expect(day((await row(early)).endDate)).toBe('2027-10-23')
  })

  test('a billing period is billed once, even by two runs at the same moment', async () => {
    setSystemTime(AFTER_MIDNIGHT)
    const id = (await json(await x.owner('/api/agreements', { method: 'POST', json: { contactId, name: 'Monthly mow', amount: 50, billingFrequency: 'monthly', startDate: '2026-10-01', endDate: '2027-10-01', renewalType: 'auto' } }))).id
    const results = await Promise.allSettled([svc().processAgreementBilling(id, x.companyId), svc().processAgreementBilling(id, x.companyId)])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((results.find((r) => r.status === 'rejected') as any).reason.alreadyBilled).toBe(true)
    const invs = await x.t.db.select().from(x.t.schema.invoice).where(eq(x.t.schema.invoice.contactId, contactId))
    expect(invs.filter((i: any) => Number(i.total) === 50).length).toBe(1)
    // Two whole runs at once over a period that is due: one invoice, and neither reports a failure.
    const id2 = (await json(await x.owner('/api/agreements', { method: 'POST', json: { contactId, name: 'Weekly edge', amount: 35, billingFrequency: 'monthly', startDate: '2026-10-01', endDate: '2027-10-01', renewalType: 'auto' } }))).id
    const runs = await Promise.all([svc().processDueAgreements(), svc().processDueAgreements()])
    expect(runs.flatMap((r: any) => r.failures)).toEqual([])
    const billed = (await x.t.db.select().from(x.t.schema.invoice).where(eq(x.t.schema.invoice.contactId, contactId))).filter((i: any) => Number(i.total) === 35)
    expect(billed.length).toBe(1)
    void id2
  })
})

describe('3 · a selection is overdue once its due day is over on the company’s clock', () => {
  test('due on the 22nd: not overdue at 10pm Chicago (UTC’s 23rd), overdue at 1am on the 23rd — the summary and the list', async () => {
    setSystemTime(EVENING)
    const x = await tenant('contractor', ['contacts', 'projects', 'selections'])
    const [p] = await x.t.db.insert(x.t.schema.project).values({ companyId: x.companyId, number: 'PRJ-1', name: 'Kitchen' } as any).returning()
    const cats = await json(await x.owner('/api/selections/categories/seed', { method: 'POST' }))
    const categoryId = (cats.data ?? cats)[0]?.id ?? (await json(await x.owner('/api/selections/categories'))).data[0].id
    const sel = await json(await x.owner(`/api/selections/project/${p.id}`, { method: 'POST', json: { name: 'Counters', categoryId, allowance: 2000, quantity: 1, dueDate: '2026-10-22' } }))
    expect(sel.id).toBeTruthy()
    const read = async () => ({
      summary: (await json(await x.owner(`/api/selections/project/${p.id}/summary`))).overdue,
      list: (await json(await x.owner('/api/selections/overdue'))).data.length,
    })
    expect(await read()).toEqual({ summary: 0, list: 0 })
    setSystemTime(AFTER_MIDNIGHT)
    expect(await read()).toEqual({ summary: 1, list: 1 })
    setSystemTime()
  })
})
