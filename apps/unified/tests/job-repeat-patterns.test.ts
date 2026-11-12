// Landscaping parity rows 18 and 19, on the shared job routes (packages/tenant-backend jobs.ts, time/series.ts), behind
// job_repeat_patterns (not ready):
//   · row 18: every N days with weekdays and days to skip, the 1st and 3rd Friday of the month, every year — and a series of up to
//     a year of visits (a twice-weekly year is 104), not 52;
//   · row 19: change this visit and every later one at once (Jobber) — time, price, description, and a weekly series' days.
// Fails without the change: the patterns were refused, 104 visits were over the 52 cap, and there was no PUT /:id/series.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq, asc } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { seriesDays, nthWeekdayOf, describeSeriesDays } from '../../../packages/tenant-backend/src/time/series.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let owner: string
let contactId: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const BASE = ['contacts', 'jobs', 'quotes', 'invoices']
const features = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
function nextWeekday(dow: number, weeksOut = 1): string {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0)
  do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() !== dow)
  return addDays(d.toISOString().slice(0, 10), (weeksOut - 1) * 7)
}
const job = (title: string, scheduledDate: string, repeat: any, extra: any = {}) => as(owner, '/api/jobs', { method: 'POST', json: { title, contactId, scheduledDate, scheduledTime: '08:00', estimatedHours: 1, ...extra, repeat } })
const visitsOf = async (seriesId: string) => (await t.db.select().from(t.schema.job).where(and(eq(t.schema.job.companyId, companyId), eq(t.schema.job.seriesId, seriesId))).orderBy(asc(t.schema.job.scheduledDate))) as any[]
const day = (v: any) => new Date(v.scheduledDate).toISOString().slice(0, 10)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  owner = await login('owner@test.example', s.password)
  contactId = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Pat Client', type: 'client' } as any).returning())[0].id
  await features(['job_repeat_patterns'])
})

describe('the days (pure)', () => {
  test('nth weekdays, every N days with skips, yearly from Feb 29', () => {
    expect(nthWeekdayOf('2026-11-01', 5, 1)).toBe('2026-11-06')
    expect(nthWeekdayOf('2026-11-01', 5, 3)).toBe('2026-11-20')
    expect(nthWeekdayOf('2026-11-01', 1, -1)).toBe('2026-11-30')
    expect(nthWeekdayOf('2026-02-01', 0, 5 as any)).toBeNull()
    expect(seriesDays({ frequency: 'monthly_nth', intervalCount: 1, firstDate: '2026-11-10', occurrencesCount: 3, nthPositions: [1, 3], nthWeekday: 5, max: 366 }).map((d) => d.date)).toEqual(['2026-11-20', '2026-12-04', '2026-12-18'])
    expect(seriesDays({ frequency: 'daily', intervalCount: 3, firstDate: '2026-11-06', occurrencesCount: 5, skipWeekdays: [0, 6], excludeDates: ['2026-11-12'], max: 366 }).map((d) => d.date)).toEqual(['2026-11-06', '2026-11-09', '2026-11-18', '2026-11-24', '2026-11-27'])
    expect(seriesDays({ frequency: 'yearly', intervalCount: 1, firstDate: '2028-02-29', occurrencesCount: 3, max: 366 }).map((d) => d.date)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28'])
    expect(describeSeriesDays({ frequency: 'monthly_nth', intervalCount: 1, nthPositions: '1,3', nthWeekday: 5, occurrencesCount: 4 } as any)).toBe('The 1st and 3rd Friday of every month, 4 times')
  })
})

describe('row 18: more repeat patterns', () => {
  test('off: the new patterns and a long series are refused in words, as before', async () => {
    await features([])
    try {
      expect((await job('Off daily', nextWeekday(1), { frequency: 'daily', interval: 3, count: 5 })).status).toBe(400)
      expect((await job('Off long', nextWeekday(1), { frequency: 'weekly', count: 60 })).status).toBe(400)
      expect(FEATURE_REGISTRY.find((f) => f.id === 'job_repeat_patterns')).toMatchObject({ templates: ['crm-landscaping'] })
    } finally { await features(['job_repeat_patterns']) }
  })

  test('every 3 days, never on a weekend, skipping a holiday', async () => {
    const first = nextWeekday(5, 2)
    const r = await job('Watering', first, { frequency: 'daily', interval: 3, count: 5, skipWeekdays: [0, 6], excludeDates: [addDays(first, 6)] })
    expect(r.status).toBe(201)
    const body = await r.json()
    const days = (await visitsOf(body.series.id)).map(day)
    expect(days).toEqual(seriesDays({ frequency: 'daily', intervalCount: 3, firstDate: first, occurrencesCount: 5, skipWeekdays: [0, 6], excludeDates: [addDays(first, 6)], max: 366 }).map((d) => d.date))
    expect(days.every((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))).toBe(true)
    expect(body.series.summary).toMatch(/^Every 3 days, never on Sun and Sat, skipping 1 day, 5 times$/)
  })

  test('the 1st and 3rd Friday; every year; a twice-weekly year is 104 visits; more than a year is refused', async () => {
    const nth = await (await job('Beds', nextWeekday(5), { frequency: 'monthly_nth', count: 4, nthPositions: [1, 3], nthWeekday: 5 })).json()
    const nthDays = (await visitsOf(nth.series.id)).map(day)
    expect(nthDays.length).toBe(4)
    expect(nthDays.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 5 && [1, 3].includes(Math.ceil(Number(d.slice(8)) / 7)))).toBe(true)
    const yearly = await (await job('Aeration', nextWeekday(2), { frequency: 'yearly', count: 2 })).json()
    const first = nextWeekday(2)
    const nextYear = `${Number(first.slice(0, 4)) + 1}${first.slice(4)}`
    expect((await visitsOf(yearly.series.id)).map(day)).toEqual([first, nextYear])
    const twice = await job('Mow twice a week', nextWeekday(1), { frequency: 'weekly', count: 104, weekdays: [1, 4] })
    expect(twice.status).toBe(201)
    expect((await visitsOf((await twice.json()).series.id)).length).toBe(104)
    expect((await job('Too long', nextWeekday(1), { frequency: 'weekly', until: addDays(nextWeekday(1), 400) })).status).toBe(400)
    expect((await job('Bad nth', nextWeekday(1), { frequency: 'monthly_nth', count: 3, nthPositions: [5], nthWeekday: 1 })).status).toBe(400)
  })
})

describe('row 19: this and future visits', () => {
  test('time, price and description change on this visit and the later ones still to do; earlier and finished ones stay', async () => {
    const r = await (await job('Weekly mow', nextWeekday(1, 2), { frequency: 'weekly', count: 5 }, { estimatedValue: 40 })).json()
    const v = await visitsOf(r.series.id)
    await t.db.update(t.schema.job).set({ status: 'completed' }).where(eq(t.schema.job.id, v[3].id))
    const res = await as(owner, `/api/jobs/${v[1].id}/series`, { method: 'PUT', json: { scheduledTime: '10:30', estimatedValue: 55, description: 'Bag the clippings' } })
    expect(res.status).toBe(200)
    expect((await res.json()).changed).toBe(3)
    const after = await visitsOf(r.series.id)
    expect(after.map((x) => x.scheduledTime)).toEqual(['08:00', '10:30', '10:30', '08:00', '10:30'])
    expect(after.map((x) => Number(x.estimatedValue))).toEqual([40, 55, 55, 40, 55])
    expect(after[2].description).toBe('Bag the clippings')
  })

  test('a weekly series’ days change from this visit on: the old days still to do are cancelled, the new ones made', async () => {
    const mon = nextWeekday(1, 3)
    const r = await (await job('Mondays', mon, { frequency: 'weekly', until: addDays(mon, 27) })).json()
    const v = await visitsOf(r.series.id)
    expect(v.map(day)).toEqual([mon, addDays(mon, 7), addDays(mon, 14), addDays(mon, 21)])
    const res = await (await as(owner, `/api/jobs/${v[2].id}/series`, { method: 'PUT', json: { weekdays: [2, 4] } })).json()
    const after = await visitsOf(r.series.id)
    const live = after.filter((x) => x.status !== 'cancelled').map(day)
    expect(live).toEqual([mon, addDays(mon, 7), addDays(mon, 15), addDays(mon, 17), addDays(mon, 22), addDays(mon, 24)])
    expect(res).toMatchObject({ cancelled: 2, made: 4 })
    expect(res.series.summary).toMatch(/on Tue and Thu/)
  })

  test('refused: a visit that does not repeat, nothing to change, a days change on a monthly series, and with the switch off', async () => {
    const single = await (await as(owner, '/api/jobs', { method: 'POST', json: { title: 'One-off', contactId, scheduledDate: nextWeekday(3) } })).json()
    expect((await as(owner, `/api/jobs/${single.id}/series`, { method: 'PUT', json: { scheduledTime: '09:00' } })).status).toBe(400)
    const monthly = await (await job('Monthly', nextWeekday(3), { frequency: 'monthly', count: 3 })).json()
    const [m] = await visitsOf(monthly.series.id)
    expect((await as(owner, `/api/jobs/${m.id}/series`, { method: 'PUT', json: {} })).status).toBe(400)
    expect((await as(owner, `/api/jobs/${m.id}/series`, { method: 'PUT', json: { weekdays: [1] } })).status).toBe(400)
    await features([])
    try { expect((await as(owner, `/api/jobs/${m.id}/series`, { method: 'PUT', json: { scheduledTime: '09:00' } })).status).toBe(403) }
    finally { await features(['job_repeat_patterns']) }
  })
})
