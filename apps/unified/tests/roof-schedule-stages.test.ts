// Roofing live test, 2026-10-22 (server/crm/roof/jobs.ts, validation.ts pipelineFor):
//  · the satellite measurement report's stage ("Measurement Ordered") is Measurement Reports' — a not-ready feature, so
//    while it is off no job is advanced, created, moved or reopened into it; with it on, the pipeline walks it as before;
//  · a roofing job can be booked for a day and a time — the CRM job's own scheduledDate (a day marker) and scheduledTime
//    (the company's wall clock) — and the calendar's week finds it (?startDate&endDate);
//  · the roof's squares are the job's own field (the insurance scope is built from them): set, cleared, never negative.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let token = ''
const ids: Record<string, string> = {}
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const features = (list: string[]) => t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
const BASE = ['jobs', 'contacts', 'scheduling']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  await features(BASE)
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh' } as any).returning()
  ids.home = home.id
}, 120_000)

const newJob = (extra: Record<string, unknown> = {}) => ({
  contactId: ids.home, jobType: 'retail', propertyAddress: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301', ...extra,
})
const setStatus = (id: string, status: string) => t.db.update(t.schema.job).set({ status } as any).where(eq(t.schema.job.id, id))

describe('the measurement stage follows Measurement Reports', () => {
  test('off: Advance from Inspected goes to Proposal Sent', async () => {
    await features(BASE)
    const j = await json(await as('/api/jobs', { method: 'POST', json: newJob() }))
    expect(j.status).toBe(201)
    ids.job = j.body.id
    await setStatus(ids.job, 'inspected')
    const r = await json(await as(`/api/jobs/${ids.job}/advance`, { method: 'POST' }))
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('proposal_sent')
  })

  test('off: the stage is refused on create, on edit and on reopen', async () => {
    await features(BASE)
    const created = await json(await as('/api/jobs', { method: 'POST', json: newJob({ status: 'measurement_ordered' }) }))
    expect([created.status, created.body.code]).toEqual([400, 'stage_off'])
    const moved = await json(await as(`/api/jobs/${ids.job}`, { method: 'PUT', json: { status: 'measurement_ordered' } }))
    expect([moved.status, moved.body.code]).toEqual([400, 'stage_off'])
    await setStatus(ids.job, 'lost')
    const reopened = await json(await as(`/api/jobs/${ids.job}/reopen`, { method: 'POST', json: { status: 'measurement_ordered' } }))
    expect([reopened.status, reopened.body.code]).toEqual([400, 'stage_off'])
    // Any other stage is as it was.
    expect((await as(`/api/jobs/${ids.job}/reopen`, { method: 'POST', json: { status: 'inspected' } })).status).toBe(200)
  })

  test('off: a job already standing in the stage advances past it', async () => {
    await features(BASE)
    await setStatus(ids.job, 'measurement_ordered')
    const r = await json(await as(`/api/jobs/${ids.job}/advance`, { method: 'POST' }))
    expect(r.body.status).toBe('proposal_sent')
  })

  test('on: the pipeline walks the measurement stage, and a job may be put in it', async () => {
    await features([...BASE, 'measurement_reports'])
    await setStatus(ids.job, 'inspected')
    const r = await json(await as(`/api/jobs/${ids.job}/advance`, { method: 'POST' }))
    expect(r.body.status).toBe('measurement_ordered')
    expect((await as(`/api/jobs/${ids.job}`, { method: 'PUT', json: { status: 'measurement_ordered' } })).status).toBe(200)
    await features(BASE)
  })
})

describe('a roofing job on the calendar', () => {
  test('booked for a day and a time: the day is the day it names, the time the wall clock', async () => {
    const r = await json(await as(`/api/jobs/${ids.job}`, { method: 'PUT', json: { scheduledDate: '2026-11-03', scheduledTime: '14:30' } }))
    expect(r.status).toBe(200)
    expect(new Date(r.body.scheduledDate).toISOString()).toBe('2026-11-03T00:00:00.000Z')
    expect(r.body.scheduledTime).toBe('14:30')
  })

  test("the calendar's week finds it, and the weeks either side do not", async () => {
    const week = await json(await as('/api/jobs?startDate=2026-11-01T00:00:00.000Z&endDate=2026-11-07T23:59:59.999Z'))
    expect(week.body.data.map((j: any) => j.id)).toContain(ids.job)
    const before = await json(await as('/api/jobs?startDate=2026-10-25T00:00:00.000Z&endDate=2026-10-31T23:59:59.999Z'))
    expect(before.body.data.map((j: any) => j.id)).not.toContain(ids.job)
    const after = await json(await as('/api/jobs?startDate=2026-11-08T00:00:00.000Z&endDate=2026-11-14T23:59:59.999Z'))
    expect(after.body.data.map((j: any) => j.id)).not.toContain(ids.job)
  })

  test("the phone's day (?date) finds it on its day only — roofing listed every job for any day (10/30)", async () => {
    const day = await json(await as('/api/jobs?date=2026-11-03&limit=100'))
    expect(day.status).toBe(200)
    expect(day.body.data.map((j: any) => j.id)).toContain(ids.job)
    for (const other of ['2026-11-02', '2026-11-04']) {
      const r = await json(await as(`/api/jobs?date=${other}&limit=100`))
      expect(r.body.data.map((j: any) => j.id)).not.toContain(ids.job)
    }
  })

  test('a time that is not one, or a day that is not one, is refused; blank clears', async () => {
    expect((await as(`/api/jobs/${ids.job}`, { method: 'PUT', json: { scheduledTime: '25:00' } })).status).toBe(400)
    expect((await as(`/api/jobs/${ids.job}`, { method: 'PUT', json: { scheduledDate: '2026-02-30' } })).status).toBe(400)
    const cleared = await json(await as(`/api/jobs/${ids.job}`, { method: 'PUT', json: { scheduledDate: '', scheduledTime: '' } }))
    expect([cleared.body.scheduledDate, cleared.body.scheduledTime]).toEqual([null, null])
  })

  test('a new job can be booked as it is made', async () => {
    const r = await json(await as('/api/jobs', { method: 'POST', json: newJob({ propertyAddress: '9 Elm St', scheduledDate: '2026-11-05', scheduledTime: '08:00' }) }))
    expect(r.status).toBe(201)
    expect([new Date(r.body.scheduledDate).toISOString().slice(0, 10), r.body.scheduledTime]).toEqual(['2026-11-05', '08:00'])
  })
})

describe("the roof's squares are the job's own", () => {
  test('set, refused below zero, and cleared', async () => {
    const set = await json(await as(`/api/jobs/${ids.job}`, { method: 'PUT', json: { totalSquares: 32.5 } }))
    expect(Number(set.body.totalSquares)).toBe(32.5)
    expect((await as(`/api/jobs/${ids.job}`, { method: 'PUT', json: { totalSquares: -3 } })).status).toBe(400)
    const cleared = await json(await as(`/api/jobs/${ids.job}`, { method: 'PUT', json: { totalSquares: '' } }))
    expect(cleared.body.totalSquares).toBeNull()
  })
})
