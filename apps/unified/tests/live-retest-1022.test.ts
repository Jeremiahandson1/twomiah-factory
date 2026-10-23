// The landscaping and roofing live retest (2026-10-22), through the real server. One file per kind (DB tests here; the
// screens are clicked in a browser). Each block names the report it answers.
//   1 jobs repeat (weekly mowing): a series of visits made on the calendar at once, shown on the job, stopped from it
//   2 maintenance contracts: a plan's visits per term become visit jobs when the agreement is made
//   4 expenses: a receipt's photo, kept privately; totals for a period
//   6 Route Board: a blank hours box is no estimate, not "One of the values is not in a valid format."
//   7 review requests: completing a job by ANY door asks (when Auto-Request is on); "Send review request" by hand
//   8 the company's clock: a quote valid until today is open all of today there; the warranty countdown counts days
import { describe, test, expect, beforeAll, afterAll, setSystemTime, setDefaultTimeout } from 'bun:test'
import { eq, and, asc, isNull } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'

// A tenant boots its whole schema into an in-memory database: seconds, not the default five.
setDefaultTimeout(60_000)

type Call = (p: string, init?: any) => Promise<Response>
const json = async (r: Response) => (await r.json()) as any

async function tenant(vertical: string, features: string[], extra: Record<string, unknown> = {}) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, ...extra } as any).where(eq(t.schema.company.id, s.company.id))
  const login = await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))
  const owner: Call = async (p, init = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${login.accessToken}` } })
  return { t, owner, companyId: s.company.id as string, ownerId: s.owner.id as string }
}

// ── 1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('1 · a job repeats, and every visit is on the calendar', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  beforeAll(async () => { x = await tenant('landscaping', ['contacts', 'jobs', 'scheduling']) })

  test('every week, 4 times: four visit jobs a week apart, numbered, in one series', async () => {
    const r = await x.owner('/api/jobs', { method: 'POST', json: { title: 'Weekly mowing', scheduledDate: '2026-11-03', scheduledTime: '09:00', repeat: { frequency: 'weekly', interval: 1, count: 4 } } })
    expect(r.status).toBe(201)
    const first = await json(r)
    expect(first.series.made).toBe(4)
    expect(first.series.summary).toBe('Every week, 4 times')
    const rows = await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.seriesId, first.series.id)).orderBy(asc(x.t.schema.job.seriesIndex))
    expect(rows.map((j: any) => j.scheduledDate.toISOString().slice(0, 10))).toEqual(['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24'])
    expect(rows.map((j: any) => j.seriesIndex)).toEqual([1, 2, 3, 4])
    expect(new Set(rows.map((j: any) => j.number)).size).toBe(4)
    expect(rows.every((j: any) => j.scheduledTime === '09:00' && j.title === 'Weekly mowing')).toBe(true)
  })

  test('every 2 weeks until a date, and every month: the same stepping', async () => {
    const two = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Fortnightly', scheduledDate: '2026-11-02', repeat: { frequency: 'weekly', interval: 2, until: '2026-12-01' } } }))
    const dates = (await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.seriesId, two.series.id)).orderBy(asc(x.t.schema.job.seriesIndex))).map((j: any) => j.scheduledDate.toISOString().slice(0, 10))
    expect(dates).toEqual(['2026-11-02', '2026-11-16', '2026-11-30'])
    const monthly = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Monthly', scheduledDate: '2027-01-31', repeat: { frequency: 'monthly', count: 3 } } }))
    const m = (await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.seriesId, monthly.series.id)).orderBy(asc(x.t.schema.job.seriesIndex))).map((j: any) => j.scheduledDate.toISOString().slice(0, 10))
    expect(m).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })

  test('a repeat with no first day or no end is refused in words; nothing is made', async () => {
    const before = (await x.t.db.select().from(x.t.schema.job)).length
    const noDay = await x.owner('/api/jobs', { method: 'POST', json: { title: 'X', repeat: { frequency: 'weekly', count: 3 } } })
    expect(noDay.status).toBe(400)
    expect((await json(noDay)).error).toContain('scheduled date')
    const noEnd = await x.owner('/api/jobs', { method: 'POST', json: { title: 'X', scheduledDate: '2026-11-03', repeat: { frequency: 'weekly' } } })
    expect(noEnd.status).toBe(400)
    expect((await json(noEnd)).error).toContain('end')
    expect((await x.t.db.select().from(x.t.schema.job)).length).toBe(before)
  })

  test('the job page says which visit of how many; Stop cancels only the later open visits', async () => {
    const first = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Hedge trim', scheduledDate: '2026-11-04', repeat: { frequency: 'weekly', count: 5 } } }))
    const rows = await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.seriesId, first.series.id)).orderBy(asc(x.t.schema.job.seriesIndex))
    const second = rows[1]
    const page = await json(await x.owner(`/api/jobs/${second.id}`))
    expect(page.series).toMatchObject({ index: 2, total: 5, upcoming: 3, status: 'active' })
    // The fourth is already under way: stopping never cancels work in hand.
    await x.t.db.update(x.t.schema.job).set({ status: 'in_progress' }).where(eq(x.t.schema.job.id, rows[3].id))
    const stop = await x.owner(`/api/jobs/${second.id}/series/stop`, { method: 'POST' })
    expect(stop.status).toBe(200)
    expect((await json(stop)).cancelled).toBe(2)
    const after = await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.seriesId, first.series.id)).orderBy(asc(x.t.schema.job.seriesIndex))
    expect(after.map((j: any) => j.status)).toEqual(['scheduled', 'scheduled', 'cancelled', 'in_progress', 'cancelled'])
    const [series] = await x.t.db.select().from(x.t.schema.jobSeries).where(eq(x.t.schema.jobSeries.id, first.series.id))
    expect(series.status).toBe('stopped')
  })

  test('a day the assignee is already booked is listed back, not double-booked', async () => {
    const busy = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Busy', scheduledDate: '2026-12-08', scheduledTime: '10:00', assignedToId: x.ownerId } }))
    expect(busy.id).toBeTruthy()
    const r = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Leaves', scheduledDate: '2026-12-01', scheduledTime: '10:00', assignedToId: x.ownerId, repeat: { frequency: 'weekly', count: 3 } } }))
    expect(r.series.made).toBe(2)
    expect(r.series.skipped).toEqual([{ date: '2026-12-08', reason: expect.stringContaining(busy.number) }])
  })
})

// ── 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('2 · a maintenance contract puts its visits on the calendar', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  let planId: string, contactId: string
  beforeAll(async () => {
    x = await tenant('landscaping', ['contacts', 'jobs', 'maintenance_contracts', 'service_agreements', 'scheduling'])
    const plan = await json(await x.owner('/api/agreements/plans', { method: 'POST', json: { name: 'Spring & Fall', price: 300, billingFrequency: 'annual', visitsIncluded: 2, durationMonths: 12 } }))
    planId = plan.id
    contactId = (await json(await x.owner('/api/contacts', { method: 'POST', json: { name: 'Dana Fern', type: 'client', address: '1 Elm St', city: 'Madison' } }))).id
  })

  test('two visits a year: two visit jobs, six months apart, against the agreement, from the first visit', async () => {
    const r = await x.owner('/api/agreements', { method: 'POST', json: { planId, contactId, startDate: '2026-11-01', firstVisitDate: '2027-04-15' } })
    expect(r.status).toBe(201)
    const agr = await json(r)
    expect(agr.visitDates).toEqual(['2027-04-15', '2027-10-15'])
    const jobs = await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.serviceAgreementId, agr.id)).orderBy(asc(x.t.schema.job.scheduledDate))
    expect(jobs.map((j: any) => [j.scheduledDate.toISOString().slice(0, 10), j.status, j.contactId, j.address])).toEqual([
      ['2027-04-15', 'scheduled', contactId, '1 Elm St'], ['2027-10-15', 'scheduled', contactId, '1 Elm St'],
    ])
    expect(jobs[0].title).toContain('visit 1 of 2')
    // The Visits column counts them: both booked, none left to book.
    const list = await json(await x.owner('/api/agreements?status=active'))
    const row = list.data.find((a: any) => a.id === agr.id)
    expect([row.visitsScheduled, row.visitsRemaining]).toEqual([2, 0])
    // "Next Service" is the next visit on the calendar (it read only the recurrence settings, so it stayed blank).
    expect(new Date(row.nextServiceDate).toISOString().slice(0, 10)).toBe('2027-04-15')
    // Asking again makes nothing twice.
    expect(await json(await x.owner(`/api/agreements/${agr.id}/schedule-visits`, { method: 'POST', json: {} }))).toEqual({ made: 0, dates: [] })
    // The recurrence engine stands aside for it, even with auto-schedule on and a visit due: the plan owns its visits.
    expect((await x.owner(`/api/agreements/${agr.id}/recurrence`, { method: 'PUT', json: { recurrenceRule: { frequency: 'quarterly' }, nextServiceDate: '2026-10-01', autoSchedule: true, reminderDaysBefore: 1 } })).status).toBe(200)
    await expect((x.t.services as any).crm.agreements.generateNextJob(agr.id, x.companyId)).rejects.toThrow('come from its plan')
    await (x.t.services as any).crm.agreements.scanAndGenerateJobs()
    expect((await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.serviceAgreementId, agr.id))).length).toBe(2)
  })

  test('four a year are three months apart; a cancelled contract takes its coming visits off the calendar', async () => {
    const plan4 = await json(await x.owner('/api/agreements/plans', { method: 'POST', json: { name: 'Quarterly', price: 400, visitsIncluded: 4, durationMonths: 12 } }))
    const agr = await json(await x.owner('/api/agreements', { method: 'POST', json: { planId: plan4.id, contactId, startDate: '2026-12-01' } }))
    expect(agr.visitDates).toEqual(['2026-12-01', '2027-03-01', '2027-06-01', '2027-09-01'])
    expect((await x.owner(`/api/agreements/${agr.id}/cancel`, { method: 'POST', json: {} })).status).toBe(200)
    const statuses = (await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.serviceAgreementId, agr.id))).map((j: any) => j.status)
    expect(statuses).toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled'])
  })

  test('a plan with no visit allowance makes no visits (booked by hand or by the recurrence settings, as before)', async () => {
    const open = await json(await x.owner('/api/agreements/plans', { method: 'POST', json: { name: 'On call', price: 50, visitsIncluded: 0, durationMonths: 12 } }))
    const agr = await json(await x.owner('/api/agreements', { method: 'POST', json: { planId: open.id, contactId, startDate: '2026-12-01' } }))
    expect(agr.visitsMade).toBe(0)
    const sched = await x.owner(`/api/agreements/${agr.id}/schedule-visits`, { method: 'POST', json: {} })
    expect(sched.status).toBe(400)
    expect((await json(sched)).error).toContain('sets no visits')
  })
})

// ── 4 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('4 · expenses: a receipt photo, and totals', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  let PNG: Buffer
  beforeAll(async () => {
    PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#a33' } }).png().toBuffer()
    x = await tenant('landscaping', ['contacts', 'jobs', 'expense_tracking'])
    Object.assign((x.t.services as any).crm.storage, {
      storageConfigured: () => true,
      put: async (key: string, body: Buffer, contentType: string) => { await x.t.store.put(key, body, contentType) },
      getObject: async (key: string) => x.t.store.getObject(key),
      deleteFile: async (key: string) => { await x.t.store.remove(key) },
    })
  })
  const form = (bytes: Uint8Array, name = 'r.png', type = 'image/png') => { const fd = new FormData(); fd.append('receipt', new File([bytes as any], name, { type })); return fd }

  test('a photo is kept privately against the expense and served back only to who may read it', async () => {
    const e = await json(await x.owner('/api/expenses', { method: 'POST', json: { date: '2026-10-01', category: 'materials', description: 'Mulch', amount: 42.5 } }))
    const up = await x.owner(`/api/expenses/${e.id}/receipt`, { method: 'POST', body: form(new Uint8Array(PNG)) })
    expect(up.status).toBe(201)
    const saved = await json(up)
    expect(saved.receiptUrl).toMatch(new RegExp(`^/api/expenses/${e.id}/receipt\\?f=[a-f0-9]{32}\\.png$`))
    // Kept under the company's private prefix, never the public website's.
    expect([...x.t.store.objects.keys()].some((k) => k.startsWith(`${x.companyId}/receipts/`))).toBe(true)
    const back = await x.owner(saved.receiptUrl)
    expect(back.status).toBe(200)
    expect(back.headers.get('content-type')).toBe('image/png')
    // Private paper: the browser keeps no copy to replay after sign-out.
    expect(back.headers.get('cache-control')).toMatch(/\bno-store\b/)
    expect(back.headers.get('cache-control')).not.toMatch(/max-age=[1-9]/)
    expect(Buffer.from(await back.arrayBuffer()).equals(PNG)).toBe(true)
    // A colleague below manager cannot read someone else's claim, nor its receipt.
    await x.t.db.insert(x.t.schema.user).values({ email: 'crew@test.example', passwordHash: await Bun.password.hash('Pass-word-1', 'bcrypt'), firstName: 'Cr', lastName: 'Ew', role: 'field', companyId: x.companyId } as any)
    const crewTok = (await json(await x.t.call('/api/auth/login', { method: 'POST', json: { email: 'crew@test.example', password: 'Pass-word-1' } }))).accessToken
    expect((await x.t.call(saved.receiptUrl, { headers: { Authorization: `Bearer ${crewTok}` } })).status).toBe(404)
  })

  test('a file that is not a photo or a PDF is refused by its bytes, whatever its name says', async () => {
    const e = await json(await x.owner('/api/expenses', { method: 'POST', json: { date: '2026-10-02', category: 'other', description: 'Odd', amount: 5 } }))
    const bad = await x.owner(`/api/expenses/${e.id}/receipt`, { method: 'POST', body: form(new TextEncoder().encode('<html><script>alert(1)</script>'), 'r.png') })
    expect(bad.status).toBe(400)
    expect((await json(bad)).error).toContain('photo')
  })

  test('the totals add up the period the list shows', async () => {
    await x.owner('/api/expenses', { method: 'POST', json: { date: '2026-09-15', category: 'travel', description: 'Fuel', amount: 60 } })
    const oct = await json(await x.owner('/api/expenses/summary?startDate=2026-10-01&endDate=2026-10-31'))
    expect(oct.total).toBe(47.5)
    expect(oct.byCategory.materials.amount).toBe(42.5)
    const all = await json(await x.owner('/api/expenses/summary'))
    expect(all.total).toBe(107.5)
  })
})

// ── 6 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('6 · the Route Board takes a blank number box as no figure', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  beforeAll(async () => { x = await tenant('landscaping', ['contacts', 'jobs', 'recurring_routes', 'area_pricing']) })

  test('a route with its hours box left empty is saved with no estimate', async () => {
    const r = await x.owner('/api/recurring-routes', { method: 'POST', json: { name: 'Monday A', dayOfWeek: 1, estimatedHours: '', notes: '' } })
    expect(r.status).toBe(201)
    expect(Number((await json(r)).estimatedHours)).toBe(0)
  })

  test('hours that are not a number are refused by the box’s name, not "not in a valid format"', async () => {
    const r = await x.owner('/api/recurring-routes', { method: 'POST', json: { name: 'Monday B', dayOfWeek: 1, estimatedHours: 'two' } })
    expect(r.status).toBe(400)
    const body = await json(r)
    expect(body.error).toContain('Estimated hours must be a number')
    expect(body.fields.estimatedHours).toBeTruthy()
    const edit = await json(await x.owner('/api/recurring-routes', { method: 'POST', json: { name: 'Tuesday', dayOfWeek: 2, estimatedHours: 3 } }))
    const cleared = await x.owner(`/api/recurring-routes/${edit.id}`, { method: 'PUT', json: { estimatedHours: '' } })
    expect(cleared.status).toBe(200)
    expect(Number((await json(cleared)).estimatedHours)).toBe(0)
  })

  test('a stop with its minutes box empty takes the half hour; a rate with no rate is asked for by name', async () => {
    const ct = await json(await x.owner('/api/contacts', { method: 'POST', json: { name: 'Rae Birch', type: 'client' } }))
    const site = await json(await x.owner('/api/sites', { method: 'POST', json: { name: 'Front lawn', contactId: ct.id } }))
    const route = await json(await x.owner('/api/recurring-routes', { method: 'POST', json: { name: 'Wed', dayOfWeek: 3 } }))
    const stop = await x.owner(`/api/recurring-routes/${route.id}/stops`, { method: 'POST', json: { siteId: site.id, estimatedMinutes: '', pricePerVisit: '' } })
    expect(stop.status).toBe(201)
    expect((await json(stop)).estimatedMinutes).toBe(30)
    const rate = await x.owner('/api/area-pricing/rates', { method: 'POST', json: { serviceType: 'Mowing', ratePer1000Sqft: '', minCharge: '' } })
    expect(rate.status).toBe(400)
    expect((await json(rate)).error).toContain('Rate per 1,000 sq ft is needed')
    const ok = await x.owner('/api/area-pricing/rates', { method: 'POST', json: { serviceType: 'Mowing', ratePer1000Sqft: '4', minCharge: '' } })
    expect(ok.status).toBe(201)
  })
})

// ── 7 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('7 · review requests', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  let contactId: string
  beforeAll(async () => {
    x = await tenant('landscaping', ['contacts', 'jobs', 'google_reviews'])
    contactId = (await json(await x.owner('/api/contacts', { method: 'POST', json: { name: 'Sam Oak', type: 'client', email: 'sam@test.example' } }))).id
  })
  const requestsFor = (jobId: string) => x.t.db.select().from(x.t.schema.reviewRequest).where(eq(x.t.schema.reviewRequest.jobId, jobId))

  test('off by default: completing a job asks nobody', async () => {
    const job = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Cleanup', contactId } }))
    expect((await x.owner(`/api/jobs/${job.id}/complete`, { method: 'POST' })).status).toBe(200)
    expect((await json(await x.owner('/api/reviews/settings'))).reviewRequestEnabled).toBe(false)
    expect((await requestsFor(job.id)).length).toBe(0)
  })

  test('with Auto-Request on, completing a job from the edit form (or the Dispatch Board) makes one, as Complete does', async () => {
    expect((await x.owner('/api/reviews/settings', { method: 'PUT', json: { reviewRequestEnabled: true, googleReviewUrl: 'https://g.page/r/test/review' } })).status).toBe(200)
    const viaButton = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Button', contactId } }))
    await x.owner(`/api/jobs/${viaButton.id}/complete`, { method: 'POST' })
    const viaEdit = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Edit form', contactId } }))
    expect((await x.owner(`/api/jobs/${viaEdit.id}`, { method: 'PUT', json: { status: 'completed' } })).status).toBe(200)
    // The hook runs after the reply; give it its turn.
    await new Promise((r) => setTimeout(r, 50))
    expect((await requestsFor(viaButton.id)).length).toBe(1)
    expect((await requestsFor(viaEdit.id)).map((r: any) => r.status)).toEqual(['pending'])
    // Saving the job again in the same status asks nobody twice.
    await x.owner(`/api/jobs/${viaEdit.id}`, { method: 'PUT', json: { status: 'completed', notes: 'tidy' } })
    expect((await requestsFor(viaEdit.id)).length).toBe(1)
  })

  test('Send review request: a job’s customer and a customer directly, sent now; a refusal says why', async () => {
    // Its own setup (each test runs alone under -t): a review link is what a request sends the customer to.
    const noLink = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Before the link', contactId } }))
    expect((await x.owner('/api/reviews/settings', { method: 'PUT', json: { googleReviewUrl: '' } })).status).toBe(200)
    const unset = await x.owner(`/api/reviews/request/${noLink.id}`, { method: 'POST', json: {} })
    expect([unset.status, (await json(unset)).error]).toEqual([400, expect.stringContaining('Google review link')])
    expect((await x.owner('/api/reviews/settings', { method: 'PUT', json: { googleReviewUrl: 'https://g.page/r/test/review' } })).status).toBe(200)
    const job = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'Manual', contactId } }))
    const sent = await x.owner(`/api/reviews/request/${job.id}`, { method: 'POST', json: { channel: 'email' } })
    expect(sent.status).toBe(200)
    expect((await requestsFor(job.id)).map((r: any) => r.status)).toEqual(['sent'])
    const direct = await x.owner(`/api/reviews/request-contact/${contactId}`, { method: 'POST', json: { channel: 'email' } })
    expect(direct.status).toBe(200)
    const nobody = (await json(await x.owner('/api/contacts', { method: 'POST', json: { name: 'No Way', type: 'client' } }))).id
    // A job whose customer cannot be reached: refused with the reason, not a 200 over a request nobody received.
    const unreachable = await json(await x.owner('/api/jobs', { method: 'POST', json: { title: 'No contact details', contactId: nobody } }))
    const viaJob = await x.owner(`/api/reviews/request/${unreachable.id}`, { method: 'POST', json: {} })
    expect(viaJob.status).toBe(400)
    expect((await json(viaJob)).error).toBe('Nothing was sent — No Way has no mobile number or email address on file.')
    const refused = await x.owner(`/api/reviews/request-contact/${nobody}`, { method: 'POST', json: {} })
    expect(refused.status).toBe(400)
    expect((await json(refused)).error).toContain('No Way has no mobile number or email address on file')
    // …and a request that could not go is recorded as failed, so the sweeper never sends it behind anyone's back.
    const direct2 = await x.t.db.select().from(x.t.schema.reviewRequest).where(and(eq(x.t.schema.reviewRequest.contactId, nobody), isNull(x.t.schema.reviewRequest.jobId)))
    expect(direct2.map((r: any) => r.status)).toEqual(['failed'])
    expect((await x.owner(`/api/reviews/request/does-not-exist`, { method: 'POST', json: {} })).status).toBe(404)
    // Another company's job is not found, never asked about.
    const [other] = await x.t.db.insert(x.t.schema.company).values({ name: 'Elsewhere', slug: 'elsewhere' }).returning()
    const [theirs] = await x.t.db.insert(x.t.schema.contact).values({ companyId: other.id, name: 'Their Customer', email: 'their@test.example' } as any).returning()
    const [theirJob] = await x.t.db.insert(x.t.schema.job).values({ companyId: other.id, number: 'JOB-00001', title: 'Theirs', contactId: theirs.id } as any).returning()
    expect((await x.owner(`/api/reviews/request/${theirJob.id}`, { method: 'POST', json: {} })).status).toBe(404)
    expect((await x.t.db.select().from(x.t.schema.reviewRequest).where(eq(x.t.schema.reviewRequest.jobId, theirJob.id))).length).toBe(0)
  })
})

// ── 8 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('8 · the company’s clock (8:30pm in Chicago, when UTC has already turned the day)', () => {
  let x: Awaited<ReturnType<typeof tenant>>
  // 2026-10-23 01:30 UTC is 2026-10-22 20:30 in Chicago.
  beforeAll(async () => {
    setSystemTime(new Date('2026-10-23T01:30:00Z'))
    x = await tenant('landscaping', ['contacts', 'quotes', 'invoices', 'jobs', 'warranties'], { timezone: 'America/Chicago', email: 'office@test.example' })
  })
  afterAll(() => { setSystemTime() })

  test('a quote valid until today is still open, and can be approved, all of today', async () => {
    const [ann] = await x.t.db.insert(x.t.schema.contact).values({ companyId: x.companyId, name: 'Ann Able', email: 'ann@test.example', type: 'client' } as any).returning()
    const sent: any[] = []
    const email: any = x.t.services.email
    const real = email.send.bind(email)
    email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ template, data }); return real(to, template, data, options) }
    const q = await json(await x.owner('/api/quotes', { method: 'POST', json: { name: 'Fall cleanup', contactId: ann.id, expiryDate: '2026-10-22', lineItems: [{ description: 'Leaves', quantity: 1, unitPrice: 200 }] } }))
    expect((await x.owner(`/api/quotes/${q.id}/send`, { method: 'POST' })).status).toBe(200)
    const token = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
    const home = await json(await x.t.call(`/api/portal/d/${token}`))
    expect(home.company.timeZone).toBe('America/Chicago')
    const page = await json(await x.t.call(`/api/portal/d/${token}/quotes/${q.id}`))
    expect(page.status).not.toBe('expired')
    const ok = await x.t.call(`/api/portal/d/${token}/quotes/${q.id}/approve`, { method: 'POST', json: { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Ann Able', consent: true } })
    expect(ok.status).toBe(200)
  })

  test('the warranty countdown counts whole days on the company’s clock', async () => {
    const ct = await json(await x.owner('/api/contacts', { method: 'POST', json: { name: 'Wes Ward', type: 'client' } }))
    // No start day given: the company's today (the 22nd in Chicago), not UTC's 23rd.
    const w = await json(await x.owner('/api/warranties', { method: 'POST', json: { name: 'Sod guarantee', contactId: ct.id, durationMonths: 12 } }))
    expect(new Date(w.expiresAt).toISOString().slice(0, 10)).toBe('2027-10-22')
    const list = await json(await x.owner('/api/warranties'))
    const row = list.data.find((r: any) => r.id === w.id)
    expect(row.daysRemaining).toBe(365)
    expect(row.isExpired).toBe(false)
    // One that ends tomorrow (the 23rd) still has a day left tonight, and is not expired.
    const soon = await json(await x.owner('/api/warranties', { method: 'POST', json: { name: 'Short', contactId: ct.id, durationMonths: 1, startDate: '2026-09-23' } }))
    const r2 = (await json(await x.owner('/api/warranties'))).data.find((r: any) => r.id === soon.id)
    expect([r2.daysRemaining, r2.isExpired, r2.isExpiringSoon]).toEqual([1, false, true])
  })
})

// ── 5 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('5 · roofing is offered the drag-and-drop calendar, and a roofing job moves by PUT', () => {
  test('the registry offers it to roofing', () => {
    expect(FEATURE_REGISTRY.find((f: any) => f.id === 'drag_drop_calendar')!.templates).toContain('crm-roof')
  })
  test('a roofing job dropped on another day and hour keeps the day and time it was given', async () => {
    const x = await tenant('roofing', ['contacts', 'jobs', 'scheduling', 'drag_drop_calendar'])
    const home = await json(await x.owner('/api/contacts', { method: 'POST', json: { name: 'Hal Roof', type: 'client' } }))
    const made = await json(await x.owner('/api/jobs', { method: 'POST', json: { contactId: home.id, jobType: 'retail', propertyAddress: '9 Ridge Rd', city: 'Akron', state: 'OH', zip: '44301', scheduledDate: '2026-11-03' } }))
    const id = (made.data ?? made).id
    expect((await x.owner(`/api/jobs/${id}`, { method: 'PUT', json: { scheduledDate: '2026-11-05' } })).status).toBe(200)
    expect((await x.owner(`/api/jobs/${id}`, { method: 'PUT', json: { scheduledTime: '13:00' } })).status).toBe(200)
    const [row] = await x.t.db.select().from(x.t.schema.job).where(and(eq(x.t.schema.job.id, id), eq(x.t.schema.job.companyId, x.companyId)))
    expect([row.scheduledDate!.toISOString().slice(0, 10), row.scheduledTime]).toEqual(['2026-11-05', '13:00'])
  })
})
