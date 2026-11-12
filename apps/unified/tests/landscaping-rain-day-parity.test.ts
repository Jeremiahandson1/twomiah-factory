// Landscaping parity rows 16, 17 and 29 — the rain day, finished (server/crm/landscaping/rainDay.ts, data/routeRainDay.ts,
// data/weatherForecast.ts).
//   · row 16: a run of days pushed at once ("this day through Friday", Yardbook shift by week), each day by the same shift, and
//     one day moved TO a chosen date (Jobber's Move Visits: exactly that date, no Sunday rule);
//   · row 29: every push is kept and can be UNDONE (visits still where it put them go back; texts not yet sent are cancelled), and a
//     big push runs in the background and emails the person who started it (Yardbook);
//   · row 17: the week's forecast (the US Weather Service) with each day's open visits, to push a rainy day from.
// Each fails without the change: throughDate / toDate / runs / undo / forecast did not exist.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { foldDays, validSpan, forecastAt } from '../server/data/weatherForecast.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let ownerId: string
let owner: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const rain = (json: any) => as(owner, '/api/recurring-routes/rain-day', { method: 'POST', json })
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const ymd = (d: any) => new Date(d).toISOString().slice(0, 10)
/** The next given weekday (0 = Sunday) after today, as YYYY-MM-DD — worked out here, not by the code under test. */
function nextWeekday(dow: number): string {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0)
  do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() !== dow)
  return d.toISOString().slice(0, 10)
}
let contactId: string
async function visitOn(day: string, label: string, time = '08:00') {
  return ins(t.schema.job, { companyId, number: `RD-${label}`, title: `Mow ${label}`, status: 'scheduled', contactId, assignedToId: ownerId, scheduledDate: new Date(`${day}T00:00:00.000Z`), scheduledTime: time })
}
const dayOf = async (id: string) => ymd((await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, id)))[0].scheduledDate)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id; ownerId = s.owner.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes', 'rain_day_tools'], address: '1 Main St', city: 'Eau Claire', state: 'WI', zip: '54701' } as any).where(eq(t.schema.company.id, companyId))
  owner = await login('owner@test.example', s.password)
  contactId = (await ins(t.schema.contact, { companyId, name: 'Pat Client', type: 'client', phone: '+17155550123' })).id
})

describe('row 16: a run of days, and to a chosen date', () => {
  test('Monday through Wednesday pushed a day: each day moves one, none is moved twice', async () => {
    const mon = nextWeekday(1)
    const a = await visitOn(mon, 'A'), b = await visitOn(addDays(mon, 1), 'B'), c = await visitOn(addDays(mon, 2), 'C')
    const outside = await visitOn(addDays(mon, 3), 'D')
    const preview = await (await rain({ date: mon, throughDate: addDays(mon, 2), shift: 'day' })).json()
    expect(preview.wouldMove).toBe(3)
    expect(preview.jobs.map((j: any) => [j.from, j.to])).toEqual([[mon, addDays(mon, 1)], [addDays(mon, 1), addDays(mon, 2)], [addDays(mon, 2), addDays(mon, 3)]])
    const r = await (await rain({ date: mon, throughDate: addDays(mon, 2), shift: 'day', dryRun: false })).json()
    expect(r.moved).toBe(3)
    expect([await dayOf(a.id), await dayOf(b.id), await dayOf(c.id), await dayOf(outside.id)]).toEqual([addDays(mon, 1), addDays(mon, 2), addDays(mon, 3), addDays(mon, 3)])
  })

  test('one day to a chosen date lands exactly there, even a Sunday; the date must come after; not both kinds at once', async () => {
    const tue = addDays(nextWeekday(2), 21)
    const v = await visitOn(tue, 'To')
    // The Sunday after that Tuesday.
    const sun = addDays(tue, 5)
    const r = await (await rain({ date: tue, toDate: sun, dryRun: false })).json()
    expect(r.moved).toBe(1)
    expect(await dayOf(v.id)).toBe(sun)
    expect((await rain({ date: tue, toDate: tue })).status).toBe(400)
    expect((await rain({ date: tue, toDate: addDays(tue, 3), throughDate: addDays(tue, 1) })).status).toBe(400)
    expect((await rain({ date: tue, throughDate: addDays(tue, 20) })).status).toBe(400)
  })
})

describe('row 29: undo, and the background run', () => {
  test('a push can be undone: visits still where it put them go back, one moved since stays, its unsent texts are cancelled', async () => {
    const wed = addDays(nextWeekday(3), 42)
    const x = await visitOn(wed, 'X', '09:00'), y = await visitOn(wed, 'Y', '10:00')
    const r = await (await rain({ date: wed, shift: 'day', dryRun: false, notify: true })).json()
    expect(r.moved).toBe(2)
    expect(r.texts.queued).toBe(1)
    // Y is moved again by hand before the undo.
    await t.db.update(t.schema.job).set({ scheduledDate: new Date(`${addDays(wed, 4)}T00:00:00.000Z`) }).where(eq(t.schema.job.id, y.id))
    const runs = (await (await as(owner, '/api/recurring-routes/rain-day/runs')).json()).data
    const run = runs.find((x: any) => x.id === r.runId)
    expect(run).toMatchObject({ status: 'done', moved: 2, canUndo: true })
    const u = await as(owner, `/api/recurring-routes/rain-day/runs/${r.runId}/undo`, { method: 'POST' })
    expect(u.status).toBe(200)
    const out = await u.json()
    expect(out.back).toBe(1)
    expect(out.stayed.map((s: any) => s.reason)).toEqual(['It has been moved again since.'])
    expect(out.textsCancelled).toBe(1)
    expect(await dayOf(x.id)).toBe(wed)
    expect(await dayOf(y.id)).toBe(addDays(wed, 4))
    const texts = await t.db.select().from(t.schema.scheduledText).where(eq(t.schema.scheduledText.contactId, contactId))
    expect(texts.every((x: any) => x.status === 'cancelled')).toBe(true)
    expect((await as(owner, `/api/recurring-routes/rain-day/runs/${r.runId}/undo`, { method: 'POST' })).status).toBe(409)
  })

  test('a background push answers at once, moves the visits, and emails the person when it is done', async () => {
    const thu = addDays(nextWeekday(4), 63)
    const v = await visitOn(thu, 'Bg')
    const mails: any[] = []
    const email: any = (t.services as any).crm.emailService
    const real = email.sendRaw
    email.sendRaw = async (m: any) => { mails.push(m) }
    try {
      const res = await rain({ date: thu, shift: 'day', dryRun: false, background: true })
      expect(res.status).toBe(202)
      const r = await res.json()
      expect(r).toMatchObject({ background: true, wouldMove: 1 })
      for (let i = 0; i < 50 && !mails.length; i++) await new Promise((ok) => setTimeout(ok, 50))
      expect(await dayOf(v.id)).toBe(addDays(thu, 1))
      expect(mails[0].to).toBe('owner@test.example')
      expect(mails[0].subject).toBe('Rain day done: 1 visit moved')
      const run = (await (await as(owner, '/api/recurring-routes/rain-day/runs')).json()).data.find((x: any) => x.id === r.runId)
      expect(run).toMatchObject({ status: 'done', moved: 1, canUndo: true })
      // One record for the run, the one the office undoes.
      const rows = await t.db.select().from(t.schema.rainDayRun).where(and(eq(t.schema.rainDayRun.companyId, companyId), eq(t.schema.rainDayRun.fromDate, thu)))
      expect(rows.length).toBe(1)
      expect((await as(owner, `/api/recurring-routes/rain-day/runs/${r.runId}/undo`, { method: 'POST' })).status).toBe(200)
      expect(await dayOf(v.id)).toBe(thu)
    } finally { email.sendRaw = real }
  })
})

describe('the switch', () => {
  test('rain_day_tools is not ready; off, the plain one-day push still works and the new parts are refused', async () => {
    const { FEATURE_REGISTRY } = await import('../../../packages/tenant-backend/src/featureRegistry.ts')
    expect(FEATURE_REGISTRY.find((f) => f.id === 'rain_day_tools')).toMatchObject({ templates: ['crm-landscaping'] })
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    try {
      const fri = addDays(nextWeekday(5), 84)
      await visitOn(fri, 'Off')
      expect((await rain({ date: fri, shift: 'day' })).status).toBe(200)
      expect((await rain({ date: fri, throughDate: addDays(fri, 1) })).status).toBe(403)
      expect((await rain({ date: fri, toDate: addDays(fri, 3) })).status).toBe(403)
      expect((await as(owner, '/api/recurring-routes/rain-day/runs')).status).toBe(403)
      expect((await as(owner, '/api/recurring-routes/rain-day/forecast')).status).toBe(403)
    } finally {
      await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes', 'rain_day_tools'] } as any).where(eq(t.schema.company.id, companyId))
      t.services.features.forgetFeatures()
    }
  })
})

describe('row 17: the week’s forecast', () => {
  test('hourly grid values fold into days: the top chance, rain and snow in inches, and a wet day', () => {
    expect(validSpan('2026-11-09T06:00:00+00:00/PT6H')).toEqual([Date.parse('2026-11-09T06:00:00Z'), Date.parse('2026-11-09T12:00:00Z')])
    expect(validSpan('2026-11-09T00:00:00+00:00/P1DT6H')![1] - validSpan('2026-11-09T00:00:00+00:00/P1DT6H')![0]).toBe(30 * 3_600_000)
    const grid = { properties: {
      probabilityOfPrecipitation: { values: [{ validTime: '2026-11-09T12:00:00+00:00/PT6H', value: 80 }, { validTime: '2026-11-10T12:00:00+00:00/PT6H', value: 10 }] },
      quantitativePrecipitation: { values: [{ validTime: '2026-11-09T12:00:00+00:00/PT6H', value: 12.7 }] },
      snowfallAmount: { values: [{ validTime: '2026-11-10T12:00:00+00:00/PT6H', value: 0 }] },
    } }
    const days = foldDays(grid, 'America/Chicago', 7, Date.parse('2026-11-09T12:00:00Z'))
    expect(days[0]).toEqual({ date: '2026-11-09', precipChance: 80, rainInches: 0.5, snowInches: 0, wet: true })
    expect(days[1]).toMatchObject({ date: '2026-11-10', precipChance: 10, wet: false })
  })

  test('the forecast route gives each day with its open visits; outside the US it says so', async () => {
    const real = globalThis.fetch
    const asked: string[] = []
    const day = new Date(); day.setUTCHours(12, 0, 0, 0)
    const iso = day.toISOString()
    globalThis.fetch = (async (input: any, init?: any) => {
      const u = String(input?.url ?? input)
      if (u.startsWith('https://api.weather.gov/points/')) { asked.push(u); return Response.json({ properties: { forecastGridData: 'https://api.weather.gov/gridpoints/MPX/1,1', forecast: 'https://api.weather.gov/gridpoints/MPX/1,1/forecast' } }) }
      if (u === 'https://api.weather.gov/gridpoints/MPX/1,1') return Response.json({ properties: { probabilityOfPrecipitation: { values: [{ validTime: `${iso}/PT1H`, value: 90 }] }, quantitativePrecipitation: { values: [{ validTime: `${iso}/PT1H`, value: 5 }] } } })
      if (u.endsWith('/forecast')) return Response.json({ properties: { periods: [{ startTime: iso, isDaytime: true, shortForecast: 'Showers' }] } })
      if (u.includes('maps.googleapis.com/maps/api/geocode')) return Response.json({ status: 'OK', results: [{ geometry: { location: { lat: 44.81, lng: -91.5 } }, formatted_address: 'Eau Claire', types: ['street_address'] }] })
      return real(input, init)
    }) as any
    const before = process.env.GOOGLE_MAPS_API_KEY
    process.env.GOOGLE_MAPS_API_KEY = 'k'
    try {
      // A job with a map point is where the business works.
      await ins(t.schema.job, { companyId, number: 'RD-PT', title: 'Point', status: 'completed', lat: 44.8113, lng: -91.4985, scheduledDate: new Date() })
      const r = await as(owner, '/api/recurring-routes/rain-day/forecast')
      expect(r.status).toBe(200)
      const days = (await r.json()).data
      expect(asked[0]).toContain('/points/44.8113,-91.4985')
      expect(days[0]).toMatchObject({ summary: 'Showers', precipChance: 90, wet: true })
      expect(typeof days[0].visits).toBe('number')
      const away = await forecastAt({ lat: 51.5, lng: -0.1 }, 'UTC', 7, (async () => new Response('', { status: 404 })) as any)
      expect('error' in away && away.error).toMatch(/United States only/)
    } finally {
      globalThis.fetch = real
      if (before === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = before
    }
  })
})
