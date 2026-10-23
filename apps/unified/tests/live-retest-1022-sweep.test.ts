// The sweep after the live retest (2026-10-22), through the real server:
//   2 an invoice is overdue once its due DAY is over on the company's clock — the admin list, its filter, the stats,
//     the dashboard and Reports, all by the rule the customer pages use (money.ts isOverdue / overdueCutoff)
//     …and a job is overdue by the same day rule
//   3 a bulk status change into Completed runs the completion step, as the job page's Complete does
// The clock is pinned: 2026-10-23 03:00 UTC is 10pm on the 22nd in Chicago; 06:00 UTC is 1am on the 23rd.
import { describe, test, expect, beforeAll, afterAll, setSystemTime, setDefaultTimeout } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

setDefaultTimeout(60_000)
type Call = (p: string, init?: any) => Promise<Response>
const json = async (r: Response) => (await r.json()) as any

async function tenant(vertical: string, features: string[], extra: Record<string, unknown> = {}) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, ...extra } as any).where(eq(t.schema.company.id, s.company.id))
  // Signed in afresh when the pinned clock moves past the session's life.
  let token = '', at = 0
  const owner: Call = async (p, init = {}) => {
    if (!token || Math.abs(Date.now() - at) > 60_000) { token = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken; at = Date.now() }
    return t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  }
  return { t, owner, companyId: s.company.id as string }
}

describe('2 · overdue on the company’s clock, everywhere the admin reads it', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  let invoiceId: string, jobId: string
  beforeAll(async () => {
    setSystemTime(new Date('2026-10-23T03:00:00Z'))
    x = await tenant('landscaping', ['contacts', 'jobs', 'quotes', 'invoices', 'dashboard', 'reports'], { timezone: 'America/Chicago' })
    const ct = await json(await x.owner('/api/contacts', { method: 'POST', json: { name: 'Owen Due', type: 'client', email: 'owen@test.example' } }))
    const inv = await json(await x.owner('/api/invoices', { method: 'POST', json: { contactId: ct.id, dueDate: '2026-10-22', lineItems: [{ description: 'Mowing', quantity: 1, unitPrice: 100 }] } }))
    invoiceId = inv.id
    expect((await x.owner(`/api/invoices/${invoiceId}/send`, { method: 'POST' })).status).toBe(200)
    // A job due on the 22nd, still open.
    jobId = (await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Hedge', scheduledDate: '2026-10-22' } }))).id
  })
  afterAll(() => { setSystemTime() })

  const readAll = async () => {
    const one = await json(await x.owner(`/api/invoices/${invoiceId}`))
    const filtered = await json(await x.owner('/api/invoices?status=overdue'))
    const stats = await json(await x.owner('/api/invoices/stats'))
    const dash = await json(await x.owner('/api/dashboard/stats'))
    const rev = await json(await x.owner('/api/reports/revenue'))
    const jobs = await json(await x.owner('/api/jobs'))
    return {
      one: one.status, filtered: filtered.data.length, stats: stats.overdue ?? 0,
      dash: dash.invoices?.overdue ?? dash.invoiceStats?.overdue, rev: rev.overdueCount,
      job: jobs.data.find((j: any) => j.id === jobId)?.isOverdue,
    }
  }

  test('10pm on the due day in Chicago (already the 23rd in UTC): not overdue, on every screen', async () => {
    setSystemTime(new Date('2026-10-23T03:00:00Z'))
    expect(await readAll()).toEqual({ one: 'sent', filtered: 0, stats: 0, dash: 0, rev: 0, job: false })
  })
  test('1am the next day in Chicago: overdue, on every screen', async () => {
    setSystemTime(new Date('2026-10-23T06:00:00Z'))
    expect(await readAll()).toEqual({ one: 'overdue', filtered: 1, stats: 1, dash: 1, rev: 1, job: true })
  })
})

describe('3 · a bulk move into Completed runs the completion step', () => {
  test('each job moved in asks for its review; one already completed asks nothing again', async () => {
    const x = await tenant('landscaping', ['contacts', 'jobs', 'google_reviews'])
    expect((await x.owner('/api/reviews/settings', { method: 'PUT', json: { reviewRequestEnabled: true, googleReviewUrl: 'https://g.page/r/bulk/review' } })).status).toBe(200)
    const ct = await json(await x.owner('/api/contacts', { method: 'POST', json: { name: 'Bea Bulk', type: 'client', email: 'bea@test.example' } }))
    const ids: string[] = []
    for (const title of ['One', 'Two', 'Done already']) ids.push((await json(await x.owner('/api/jobs', { method: 'POST', json: { title, contactId: ct.id } }))).id)
    await x.t.db.update(x.t.schema.job).set({ status: 'completed' }).where(eq(x.t.schema.job.id, ids[2]))
    const r = await x.owner('/api/bulk/jobs/status', { method: 'POST', json: { ids, status: 'completed' } })
    expect(r.status).toBe(200)
    expect((await json(r)).updated).toBe(3)
    // The completion step asks the reviews service without holding the reply; give it its turn.
    await new Promise((res) => setTimeout(res, 100))
    const reqs = await x.t.db.select().from(x.t.schema.reviewRequest)
    expect(reqs.map((q: any) => q.jobId).sort()).toEqual([ids[0], ids[1]].sort())
  })
})
