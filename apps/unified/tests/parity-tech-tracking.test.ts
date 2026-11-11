// Parity tier 2 #7 (11/10): "where's my tech" — the on-my-way text carries a private link to where the tech is (ServiceTitan's and
// Jobber's live tracking link). Through the real server as field service:
//   · with tech_tracking on, the "on my way" text carries /on-the-way/<token>; off, the text is as before;
//   · the page shows the tech's newest position while they are on the way (only a fresh one), "arrived" once they start, and
//     "over" once the job is done or the link has run out — never a position after they arrive;
//   · the link cannot be made up or altered, and closes when the feature is off.
import { test, expect, beforeAll, setSystemTime, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { readTrackToken, trackToken, TRACK_HOURS } from '../server/crm/field/techTrack.ts'
import { jobUpdateTemplate } from '../../../packages/tenant-backend/src/integrations/sms.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', hank = '', tia = ''
const tok: Record<string, string> = {}
const carrier: any[] = []
const call = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any)
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const FEATURES = ['jobs', 'contacts', 'team', 'dashboard', 'two_way_texting', 'gps_tracking', 'tech_tracking']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const page = async (token: string) => json(await t.call(`/api/tech-track/${token}`))
const textFor = (jobId: string) => carrier.map((m) => String(m.Body ?? m.body ?? '')).filter((b) => b.includes('on the way')).at(-1) ?? ''
const newJob = async (title: string, scheduledTime: string) => {
  const r = await json(await call('owner', '/api/jobs', { method: 'POST', json: { title, contactId: hank, scheduledDate: '2026-11-10', scheduledTime, assignedToId: tia } }))
  expect(r.status).toBe(201)
  return r.body
}
const settle = () => new Promise((r) => setTimeout(r, 50))

beforeAll(async () => {
  process.env.FRONTEND_URL = 'https://crm.heating.example'
  process.env.TWILIO_ACCOUNT_SID = 'ACtest'
  process.env.TWILIO_AUTH_TOKEN = 'test-token'
  process.env.TWILIO_PHONE_NUMBER = '+16085550100'
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
  await setFeatures(FEATURES)
  ;(t.services as any).crm.sms.setTransport(async (params: any) => { carrier.push(params); return { sid: `SM${carrier.length}`, numSegments: '1' } })
  tok.owner = (await login('owner@test.example', s.password)).accessToken
  const made = await json(await call('owner', '/api/company/users', { method: 'POST', json: { email: 'tia@heating.example', firstName: 'Tia', lastName: 'Tech', role: 'field', password: 'Long-enough-pass-1' } }))
  tia = made.body.id ?? made.body.user?.id
  hank = (await ins(t.schema.contact, { companyId, name: 'Hank Homeowner', type: 'client', mobile: '+16085550111' })).id
}, 120_000)
afterEach(() => setSystemTime())

test('the key: made for one job, cannot be altered, and carries when it was made', () => {
  const at = new Date('2026-11-10T20:00:00Z')
  const k = trackToken('abcdefghij0123456789', at)
  expect(readTrackToken(k)).toEqual({ jobId: 'abcdefghij0123456789', madeAt: at })
  expect(readTrackToken(k.replace('abcdefghij', 'zzzzzzzzzz'))).toBeNull()
  expect(readTrackToken(k.slice(0, -1) + (k.endsWith('A') ? 'B' : 'A'))).toBeNull()
  expect(readTrackToken('nothing')).toBeNull()
  expect(jobUpdateTemplate('on_my_way', { trackUrl: 'https://x.example/on-the-way/k' })).toEndWith(' See where they are: https://x.example/on-the-way/k')
  expect(jobUpdateTemplate('completed', { trackUrl: 'https://x.example/on-the-way/k' })).not.toContain('See where')
})

test('on my way: the text carries the link; the page follows the tech, then says arrived, then over', async () => {
  const j = await newJob('No heat', '09:00')
  expect((await call('owner', `/api/jobs/${j.id}/dispatch`, { method: 'POST', json: {} })).status).toBe(200)
  await settle()
  const text = textFor(j.id)
  expect(text).toContain('is on the way')
  const m = /https:\/\/crm\.heating\.example\/on-the-way\/(\S+)$/.exec(text)
  expect(m).not.toBeNull()
  const token = m![1]

  // Nothing from the phone yet: on the way, no map.
  let v = await page(token)
  expect(v.status).toBe(200)
  expect(v.body).toMatchObject({ techName: 'Tia', state: 'on_the_way', tech: null })

  // A stale fix is not shown; a fresh one is.
  await ins(t.schema.locationLog, { companyId, userId: tia, lat: 43.0, lng: -89.0, timestamp: new Date(Date.now() - 40 * 60_000) })
  expect((await page(token)).body.tech).toBeNull()
  await ins(t.schema.locationLog, { companyId, userId: tia, lat: 43.07, lng: -89.4, timestamp: new Date(Date.now() - 2 * 60_000) })
  v = await page(token)
  expect(v.body.tech).toMatchObject({ lat: 43.07, lng: -89.4, minutesAgo: 2 })

  // Started: arrived, and the position is no longer given.
  expect((await call('owner', `/api/jobs/${j.id}/start`, { method: 'POST', json: {} })).status).toBe(200)
  v = await page(token)
  expect(v.body).toMatchObject({ state: 'arrived', tech: null })

  // Done: over.
  expect((await call('owner', `/api/jobs/${j.id}/complete`, { method: 'POST', json: {} })).status).toBe(200)
  expect((await page(token)).body.state).toBe('over')
})

test(`the link runs out after ${TRACK_HOURS} hours, and an altered one opens nothing`, async () => {
  const j = await newJob('Furnace noise', '12:00')
  await call('owner', `/api/jobs/${j.id}/dispatch`, { method: 'POST', json: {} })
  const old = trackToken(j.id, new Date(Date.now() - (TRACK_HOURS * 60 + 1) * 60_000))
  const v = await page(old)
  expect(v.body).toMatchObject({ state: 'over', tech: null, destination: null })
  expect((await page(old.slice(0, -2) + 'zz')).status).toBe(404)
})

test('switched off: the text is as before and the link opens nothing', async () => {
  await setFeatures(FEATURES.filter((f) => f !== 'tech_tracking'))
  try {
    const j = await newJob('Thermostat', '15:00')
    carrier.length = 0
    await call('owner', `/api/jobs/${j.id}/dispatch`, { method: 'POST', json: {} })
    await settle()
    expect(textFor(j.id)).toContain('is on the way')
    expect(textFor(j.id)).not.toContain('See where they are')
    expect((await page(trackToken(j.id))).status).toBe(404)
  } finally { await setFeatures(FEATURES) }
})
