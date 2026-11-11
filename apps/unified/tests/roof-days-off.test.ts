// The business's days off on roofing's own jobs (crm/roof/jobs.ts; feature days_off). Live test 11/11: a roofing job booked onto
// a holiday — made, rescheduled, or moved on the Schedule — said nothing; every other trade's jobs ask first. Now the same
// 409 the screens read to offer "Book anyway", for the job's appointment, inspection and install days; booking anyway saves it;
// with Days Off off, or on an open day, nothing is asked.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', home = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const FEATURES = ['jobs', 'contacts', 'days_off']
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const newJob = (extra: Record<string, unknown> = {}) => ({ contactId: home, jobType: 'retail', propertyAddress: '14 Gable Ct', city: 'Akron', state: 'OH', zip: '44301', ...extra })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(FEATURES)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  home = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Rory Roofclient', type: 'client' } as any).returning()) as any[])[0].id
  expect((await call('/api/days-off', { method: 'POST', json: { date: '2026-11-13', reason: 'Staff day' } })).status).toBe(201)
}, 120_000)

test('a new job on the closed day: asked first, and saved when booked anyway', async () => {
  const r = await json(await call('/api/jobs', { method: 'POST', json: newJob({ scheduledDate: '2026-11-13' }) }))
  expect([r.status, r.body.code]).toEqual([409, 'unavailable'])
  expect(r.body.error).toContain('The business is closed on')
  expect(r.body.error).toContain('Staff day')
  const anyway = await json(await call('/api/jobs', { method: 'POST', json: newJob({ scheduledDate: '2026-11-13', bookAnyway: true }) }))
  expect(anyway.status).toBe(201)
  // An open day: nothing asked.
  expect((await call('/api/jobs', { method: 'POST', json: newJob({ scheduledDate: '2026-11-12' }) })).status).toBe(201)
})

test('moved onto the closed day (the job page, or the Schedule): asked; its install day too; unchanged days are not asked again', async () => {
  const id = (await json(await call('/api/jobs', { method: 'POST', json: newJob({ scheduledDate: '2026-11-12' }) }))).body.id
  const moved = await json(await call(`/api/jobs/${id}`, { method: 'PUT', json: { scheduledDate: '2026-11-13' } }))
  expect([moved.status, moved.body.code]).toEqual([409, 'unavailable'])
  expect((await call(`/api/jobs/${id}`, { method: 'PUT', json: { installDate: '2026-11-13' } })).status).toBe(409)
  expect((await call(`/api/jobs/${id}`, { method: 'PUT', json: { scheduledDate: '2026-11-13', bookAnyway: true } })).status).toBe(200)
  // Already on that day: another edit to the job is not asked about it again.
  expect((await call(`/api/jobs/${id}`, { method: 'PUT', json: { scheduledDate: '2026-11-13', scheduledTime: '09:00' } })).status).toBe(200)
})

test('Days Off switched off: nothing asked', async () => {
  await setFeatures(['jobs', 'contacts'])
  expect((await call('/api/jobs', { method: 'POST', json: newJob({ scheduledDate: '2026-11-13' }) })).status).toBe(201)
  await setFeatures(FEATURES)
})
