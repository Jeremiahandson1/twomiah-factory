// The public booking door holds the slot list's own rules, and the office's schedule holds its time online
// (live test 2026-10-22): a booking past the window or without the phone the form asks for is a plain 400 naming the
// problem, and a service call on a technician's calendar takes those times off the website like any other busy time.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { addDays, tzParts } from '@twomiah/tenant-backend'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', ownerId = '', token = ''
const TZ = 'America/Chicago'
let day = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const times = async (date: string) => ((await (await t.call(`/api/book/services/consultation/times?date=${date}`)).json()).data as any[]).map((x) => x.time)
const who = { name: 'Pat Lee', email: 'pat@example.com', phone: '608-555-0100', address: '1 Elm St' }

beforeAll(async () => {
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id; ownerId = s.owner.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  expect((await as('/api/company/features', { method: 'PUT', json: { features: ['online_booking'] } })).status).toBe(200)
  // One clock (coordinator 10/23): the business's zone, set in Settings › Company, is the one Bookings keeps time on.
  await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, companyId))
  expect((await as('/api/booking/settings', { method: 'PATCH', json: { timezone: TZ, enabled: true, maxDaysOut: 30, leadTimeMinutes: 60 } })).status).toBe(200)
  expect((await as('/api/booking/services', { method: 'POST', json: { name: 'Consultation', durationMinutes: 60, slotStepMinutes: 60 } })).status).toBe(201)
  expect((await as('/api/booking/hours', { method: 'PUT', json: { hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00' })) } })).status).toBe(200)
  day = addDays(tzParts(new Date(), TZ).date, 3)
})

describe('the public create holds the same rules as the slot list', () => {
  test('a day past the window is not offered and not taken', async () => {
    const far = addDays(tzParts(new Date(), TZ).date, 69)
    expect(await times(far)).toEqual([])
    const r = await t.call('/api/book/services/consultation', { method: 'POST', json: { ...who, date: far, time: '10:00' } })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toContain('within 30 days')
  })

  test('no phone is refused when the form asks for one', async () => {
    const r = await t.call('/api/book/services/consultation', { method: 'POST', json: { ...who, phone: '', date: day, time: '10:00' } })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toContain('phone')
  })
})

describe("a job on someone's schedule holds its time online", () => {
  let jobId = ''
  test('a 10:00 two-hour service call takes 10:00 and 11:00 off the website, and the create refuses them', async () => {
    expect(await times(day)).toContain('10:00')
    const [j] = await t.db.insert(t.schema.job).values({
      companyId, number: 'JOB-00001', title: 'Furnace service', status: 'scheduled',
      scheduledDate: new Date(`${day}T00:00:00.000Z`), scheduledTime: '10:00', estimatedHours: '2', assignedToId: ownerId,
    }).returning()
    jobId = j.id
    const open = await times(day)
    expect(open).not.toContain('10:00')
    expect(open).not.toContain('11:00')
    expect(open).toContain('09:00')
    expect(open).toContain('12:00')
    const r = await t.call('/api/book/services/consultation', { method: 'POST', json: { ...who, date: day, time: '10:00' } })
    expect(r.status).toBe(409)
  })

  test('a cancelled call frees the time; a call with no clock time holds none', async () => {
    await t.db.update(t.schema.job).set({ status: 'cancelled' }).where(eq(t.schema.job.id, jobId))
    expect(await times(day)).toContain('10:00')
    await t.db.insert(t.schema.job).values({ companyId, number: 'JOB-00002', title: 'Someday', status: 'scheduled', scheduledDate: new Date(`${day}T00:00:00.000Z`), assignedToId: ownerId })
    expect(await times(day)).toContain('10:00')
  })
})
