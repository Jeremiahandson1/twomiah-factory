// Landscaping gap 2, "recurring patterns": a repeating job can run on chosen days of the week (Monday and Thursday), not just
// the one weekday of its first visit. The stepping is the shared series module's (additive: no weekdays = as before); the
// server takes `repeat.weekdays` only where the vertical turns it on (landscaping). Each test fails without the change:
// `weekdays` was ignored, so a Mon+Thu job came out as six Mondays.
import { describe, test, expect, setDefaultTimeout } from 'bun:test'
import { eq, asc } from 'drizzle-orm'
import { seriesDays, describeSeriesDays } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

setDefaultTimeout(60_000)
const json = async (r: Response) => (await r.json()) as any

async function tenant(vertical: string) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs'] } as any).where(eq(t.schema.company.id, s.company.id))
  const login = await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))
  const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${login.accessToken}` } })
  return { t, call, companyId: s.company.id as string }
}
const days = (spec: any) => seriesDays(spec).map((d) => d.date)

describe('the stepping', () => {
  test('Monday and Thursday, every week; a day before the first visit in its week is not made', () => {
    // 2026-11-02 is a Monday.
    expect(days({ frequency: 'weekly', intervalCount: 1, firstDate: '2026-11-02', occurrencesCount: 6, weekdays: [4, 1] }))
      .toEqual(['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12', '2026-11-16', '2026-11-19'])
    // First visit on the Wednesday: that week's Monday is behind it.
    expect(days({ frequency: 'weekly', intervalCount: 1, firstDate: '2026-11-04', occurrencesCount: 3, weekdays: [1, 4] }))
      .toEqual(['2026-11-05', '2026-11-09', '2026-11-12'])
  })
  test('every 2 weeks, an end date, junk days dropped, and no weekdays = as before', () => {
    expect(days({ frequency: 'weekly', intervalCount: 2, firstDate: '2026-11-02', occurrencesCount: 4, weekdays: [1, 4] }))
      .toEqual(['2026-11-02', '2026-11-05', '2026-11-16', '2026-11-19'])
    expect(days({ frequency: 'weekly', intervalCount: 1, firstDate: '2026-11-02', untilDate: '2026-11-10', weekdays: [1, 4] }))
      .toEqual(['2026-11-02', '2026-11-05', '2026-11-09'])
    expect(days({ frequency: 'weekly', intervalCount: 1, firstDate: '2026-11-02', occurrencesCount: 3, weekdays: [9, -1, 1.5] }))
      .toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
    expect(days({ frequency: 'weekly', intervalCount: 1, firstDate: '2026-11-02', occurrencesCount: 3 })).toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
  })
  test('said in words', () => {
    expect(describeSeriesDays({ frequency: 'weekly', intervalCount: 1, occurrencesCount: 6, weekdays: [1, 4] })).toBe('Every week on Mon and Thu, 6 times')
    expect(describeSeriesDays({ frequency: 'weekly', intervalCount: 2, occurrencesCount: null, weekdays: '1,3,5' })).toBe('Every 2 weeks on Mon, Wed and Fri')
    expect(describeSeriesDays({ frequency: 'weekly', intervalCount: 1, occurrencesCount: 3 })).toBe('Every week, 3 times')
  })
})

describe('on the real server', () => {
  test('landscaping: Mon + Thu makes the visits on those days, numbered, in the series, and the job page says so', async () => {
    const x = await tenant('landscaping')
    const r = await x.call('/api/jobs', { method: 'POST', json: { title: 'Twice-weekly mowing', scheduledDate: '2026-11-02', scheduledTime: '09:00', repeat: { frequency: 'weekly', interval: 1, count: 6, weekdays: [1, 4] } } })
    expect(r.status).toBe(201)
    const first = await json(r)
    expect(first.series.made).toBe(6)
    expect(first.series.summary).toBe('Every week on Mon and Thu, 6 times')
    const rows = await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.seriesId, first.series.id)).orderBy(asc(x.t.schema.job.seriesIndex))
    expect(rows.map((j: any) => j.scheduledDate.toISOString().slice(0, 10))).toEqual(['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12', '2026-11-16', '2026-11-19'])
    expect(new Set(rows.map((j: any) => j.number)).size).toBe(6)
    const page = await json(await x.call(`/api/jobs/${rows[2].id}`))
    expect(page.series.summary).toBe('Every week on Mon and Thu, 6 times')
    expect(page.series.total).toBe(6)
  })

  test('a plain weekly repeat is unchanged, and weekdays that make no sense are refused in words with nothing made', async () => {
    const x = await tenant('landscaping')
    const plain = await json(await x.call('/api/jobs', { method: 'POST', json: { title: 'Plain', scheduledDate: '2026-11-02', repeat: { frequency: 'weekly', count: 3 } } }))
    expect(plain.series.summary).toBe('Every week, 3 times')
    const before = (await x.t.db.select().from(x.t.schema.job)).length
    const monthly = await x.call('/api/jobs', { method: 'POST', json: { title: 'M', scheduledDate: '2026-11-02', repeat: { frequency: 'monthly', count: 3, weekdays: [1, 4] } } })
    expect(monthly.status).toBe(400)
    expect((await json(monthly)).error).toContain('weekly')
    const junk = await x.call('/api/jobs', { method: 'POST', json: { title: 'J', scheduledDate: '2026-11-02', repeat: { frequency: 'weekly', count: 3, weekdays: [1, 12] } } })
    expect(junk.status).toBe(400)
    expect((await x.t.db.select().from(x.t.schema.job)).length).toBe(before)
  })

  test('another vertical does not take weekdays (its job form does not offer them)', async () => {
    const x = await tenant('fieldservice')
    const r = await x.call('/api/jobs', { method: 'POST', json: { title: 'HVAC check', scheduledDate: '2026-11-02', repeat: { frequency: 'weekly', count: 3, weekdays: [1, 4] } } })
    expect(r.status).toBe(400)
    expect((await json(r)).error).toContain('not offered')
  })
})
