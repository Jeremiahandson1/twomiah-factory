// Item 2 of the field-service depth brief: clock in and out from the phone (the routes the phone's Clock screen calls,
// /api/time/clock-in, /clock-out, /active) beside the geofence's automatic clock in/out. Through the real server and the real
// login, on BOTH field service and basic.
//   · a field seat clocks in and out, sees its open clock, and is refused a second clock-in;
//   · a clock sent LATER from the offline queue carries the moment the tech tapped (`at`): the hours are those worked, not
//     those between sending; a time in the future, over 48 hours old, or before the clock-in is refused in words;
//   · without `at` nothing changes (the entry is stamped when it arrives);
//   · a Viewer seat is refused; the door is closed while Time Tracking is off;
//   · the geofence's automatic clock-in (tracking and auto clock on, the phone's location inside a job-site fence) opens the
//     same clock the Clock screen shows, and the tech can clock out by hand.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'jobs', 'time_tracking', 'gps_tracking']
const HOUR = 3_600_000

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let co = ''
    const tok: Record<string, string> = {}
    const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
    const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
      const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tok[who]}` } })
      const text = await r.text(); let body: any = text
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      return { status: r.status, body }
    }
    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
    /** Close whatever is open for a seat so each test starts clean. */
    const reset = async (who: string) => { const a = await as(who, '/api/time/active'); if (a.body?.id) await t.db.delete(t.schema.timeEntry).where(eq(t.schema.timeEntry.id, a.body.id)) }

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      co = s.company.id
      await features(FEATURES)
      const login = async (e: string, p: string) => ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } })).json()) as any).accessToken
      tok.owner = await login('owner@test.example', s.password)
      for (const [key, role] of Object.entries({ tia: 'field', viewer: 'viewer' })) {
        await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: key, lastName: 'Seat', role, companyId: co })
        tok[key] = await login(`${key}@test.example`, 'Seat-pass-1')
      }
    }, 120_000)

    test('a field seat clocks in, sees the open clock, is refused a second one, and clocks out', async () => {
      await reset('tia')
      expect((await as('tia', '/api/time/active')).body).toBeNull()
      const inn = await as('tia', '/api/time/clock-in', 'POST', {})
      expect(inn.status).toBe(201)
      expect((await as('tia', '/api/time/active')).body.id).toBe(inn.body.id)
      const twice = await as('tia', '/api/time/clock-in', 'POST', {})
      expect(twice.status).toBe(409)
      expect(twice.body.error).toContain('Already clocked in')
      // Pretend an hour has passed, so clocking out is a shift and not a mis-click.
      await t.db.update(t.schema.timeEntry).set({ clockIn: new Date(Date.now() - HOUR) } as any).where(eq(t.schema.timeEntry.id, inn.body.id))
      const out = await as('tia', '/api/time/clock-out', 'POST', {})
      expect(out.status).toBe(200)
      expect(Number(out.body.hours)).toBeGreaterThan(0.9)
      expect((await as('tia', '/api/time/active')).body).toBeNull()
    })

    test('a clock sent later carries the moment it was tapped', async () => {
      await reset('tia')
      const inn = await as('tia', '/api/time/clock-in', 'POST', { at: ago(3 * HOUR) })
      expect(inn.status).toBe(201)
      expect(Math.abs(new Date(inn.body.clockIn).getTime() - (Date.now() - 3 * HOUR))).toBeLessThan(5_000)
      const out = await as('tia', '/api/time/clock-out', 'POST', { at: ago(0) })
      expect(out.status).toBe(200)
      expect(Number(out.body.hours)).toBeGreaterThan(2.9)
      expect(Number(out.body.hours)).toBeLessThan(3.1)
    })

    test('a clock-out tapped before the clock-in is refused; so are times that have not happened or are too old', async () => {
      await reset('tia')
      expect((await as('tia', '/api/time/clock-in', 'POST', { at: new Date(Date.now() + 10 * 60_000).toISOString() })).status).toBe(400)
      const old = await as('tia', '/api/time/clock-in', 'POST', { at: ago(49 * HOUR) })
      expect(old.status).toBe(400)
      expect(old.body.error).toContain('48 hours')
      expect((await as('tia', '/api/time/clock-in', 'POST', { at: 'yesterday' })).status).toBe(400)
      expect((await as('tia', '/api/time/active')).body).toBeNull()
      expect((await as('tia', '/api/time/clock-in', 'POST', { at: ago(2 * HOUR) })).status).toBe(201)
      const before = await as('tia', '/api/time/clock-out', 'POST', { at: ago(3 * HOUR) })
      expect(before.status).toBe(400)
      expect(before.body.error).toContain('before you clocked in')
      expect((await as('tia', '/api/time/active')).body).not.toBeNull()
      await reset('tia')
    })

    test('without a tapped time the entry is stamped when it arrives', async () => {
      await reset('tia')
      const inn = await as('tia', '/api/time/clock-in', 'POST', {})
      expect(Math.abs(new Date(inn.body.clockIn).getTime() - Date.now())).toBeLessThan(10_000)
      await reset('tia')
    })

    test('the doors: a Viewer is refused; closed while Time Tracking is off; signed in only', async () => {
      expect((await as('viewer', '/api/time/clock-in', 'POST', {})).status).toBe(403)
      expect((await as('viewer', '/api/time/clock-out', 'POST', {})).status).toBe(403)
      expect((await t.call('/api/time/clock-in', { method: 'POST', json: {} })).status).toBe(401)
      await features(FEATURES.filter((f) => f !== 'time_tracking'))
      try { expect([403, 404]).toContain((await as('tia', '/api/time/clock-in', 'POST', {})).status) } finally { await features(FEATURES) }
    })

    test('the geofence opens the same clock the Clock screen shows; the tech can clock out by hand', async () => {
      await reset('tia')
      const fence = await as('owner', '/api/geofencing', 'POST', { name: 'Ann Able house', lat: 43.0731, lng: -89.4012, radius: 150 })
      expect(fence.status).toBe(201)
      // Off by default: a location inside the fence clocks nobody in.
      expect((await as('tia', '/api/geofencing/location', 'POST', { lat: 43.0731, lng: -89.4012, accuracy: 10 })).body.tracking).toBe(false)
      expect((await as('tia', '/api/time/active')).body).toBeNull()
      expect((await as('tia', '/api/geofencing/settings', 'PUT', { locationTrackingEnabled: true, autoClockEnabled: true })).status).toBe(200)
      const arrive = await as('tia', '/api/geofencing/location', 'POST', { lat: 43.0731, lng: -89.4012, accuracy: 10 })
      expect(arrive.status).toBe(200)
      expect(arrive.body.actions.some((a: any) => a.type === 'clock_in')).toBe(true)
      const open = (await as('tia', '/api/time/active')).body
      expect(open).not.toBeNull()
      await t.db.update(t.schema.timeEntry).set({ clockIn: new Date(Date.now() - HOUR) } as any).where(eq(t.schema.timeEntry.id, open.id))
      const out = await as('tia', '/api/time/clock-out', 'POST', {})
      expect(out.status).toBe(200)
      expect((await as('tia', '/api/time/active')).body).toBeNull()
    })
  })
}
