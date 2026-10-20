// Location while working (crm/field/geofencing.ts), the way the field-service apps do it: each person's own switch to
// share their location, a separate switch to be clocked in and out at job sites, a phone notice when that happens, and
// the office's "where's the crew". Sends are recorded by the harness.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tok: Record<string, string> = {}
const ids: Record<string, string> = {}
const as = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const SITE = { lat: 44.8113, lng: -91.4985 }
const AWAY = { lat: 44.9, lng: -91.4985 }
const at = (who: string, p: { lat: number; lng: number }) => as(who, '/api/geofencing/location', { method: 'POST', json: { ...p, accuracy: 10 } })
let seen = 0
const sentSince = () => { const out = t.pushed.slice(seen).map((m: any) => `${m.title} — ${m.body}`); seen = t.pushed.length; return out }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'gps_tracking', 'time_tracking', 'team'] }).where(eq(t.schema.company.id, s.company.id))
  tok.owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json()).accessToken
  for (const who of ['tech', 'quiet']) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${who}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: who === 'tech' ? 'Terry' : 'Quinn', lastName: 'Field', role: 'field', companyId: s.company.id }).returning()
    ids[who] = u.id
    tok[who] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${who}@test.example`, password: 'Seat-pass-1' } })).json()).accessToken
  }
  await as('tech', '/api/push/expo-token', { method: 'POST', json: { token: 'ExponentPushToken[terry]' } })
  const fence = await as('owner', '/api/geofencing', { method: 'POST', json: { name: 'Miller house', ...SITE, radius: 150 } })
  expect(fence.status).toBe(201)
})

describe('location while working', () => {
  test('tracking off: the location is ignored', async () => {
    expect((await (await at('tech', SITE)).json()).tracking).toBe(false)
  })

  test('tracking on, auto clock off: the location is kept, nobody is clocked in', async () => {
    await as('tech', '/api/geofencing/settings', { method: 'PUT', json: { locationTrackingEnabled: true, autoClockEnabled: false } })
    await at('tech', AWAY)
    const r = await (await at('tech', SITE)).json()
    expect(r).toEqual({ actions: [], tracking: true })
    const open = await t.db.select().from(t.schema.timeEntry).where(eq(t.schema.timeEntry.userId, ids.tech))
    expect(open.length).toBe(0)
    expect(sentSince()).toEqual([])
  })

  test('auto clock on: arriving clocks in, leaving clocks out, and the phone is told each time', async () => {
    await as('tech', '/api/geofencing/settings', { method: 'PUT', json: { autoClockEnabled: true } })
    await at('tech', AWAY)
    const arrive = await (await at('tech', SITE)).json()
    expect(arrive.actions.map((a: any) => a.type)).toEqual(['clock_in'])
    await Bun.sleep(50)
    expect(sentSince()).toEqual(['Clocked in — You arrived at Miller house'])
    const leave = await (await at('tech', AWAY)).json()
    expect(leave.actions.map((a: any) => a.type)).toEqual(['clock_out'])
    await Bun.sleep(50)
    expect(sentSince()[0]).toMatch(/^Clocked out — You left Miller house/)
  })

  test("where's the crew: the office sees who shares their location and where; nobody else is listed", async () => {
    await at('tech', SITE)
    const r = await as('owner', '/api/geofencing/crew')
    expect(r.status).toBe(200)
    const crew = (await r.json()).data
    expect(crew.map((m: any) => m.name)).toEqual(['Terry Field'])
    expect(crew[0]).toMatchObject({ lat: SITE.lat, lng: SITE.lng, onTheClock: true })
    expect(typeof crew[0].seenAt).toBe('string')
  })

  test("a field seat may not see where everyone is", async () => {
    expect((await as('quiet', '/api/geofencing/crew')).status).toBe(403)
  })
})
