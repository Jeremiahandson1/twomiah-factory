// Item 4 of the field-service parity brief: the clock, finished — through the real server and the real login, on BOTH
// field service and basic.
//   · breaks: start/end on the open clock; their minutes come off the hours at clock-out; one still running ends with the shift;
//   · a GPS stamp on each clock tap (both numbers or neither);
//   · an entry whose time a phone tap moved (more than two minutes either side of when the server heard it) is marked
//     "time set by the phone" for the approver; a tap that arrived on time is not;
//   · a hand clock-in is no longer recorded as an automatic one (the geofence's still is);
//   · automatic timekeeping (setting): "On my way" or "Arrive" starts the tech's timesheet, Complete ends the clock the job
//     opened — and only that one; the office dispatching a job, or a tech not on it, clocks nobody;
//   · overtime alerts: near and over a daily limit, told once to the person and the managers; the office's list;
//   · the kiosk: off by default; a manager's tablet, each person's own PIN, five wrong PINs and it stops;
//   · the geofence's automatic clock-OUT, on leaving the fence, with the break taken off and the place kept.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'jobs', 'time_tracking', 'gps_tracking']
const MIN = 60_000

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let co = ''
    let customer = ''
    const ids: Record<string, string> = {}
    const tok: Record<string, string> = {}
    const pushes: Array<{ to: string[]; title: string; body: string }> = []
    const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
    const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
      const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tok[who]}` } })
      const text = await r.text(); let body: any = text
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      return { status: r.status, body }
    }
    const ago = (min: number) => new Date(Date.now() - min * MIN).toISOString()
    const entry = async (id: string) => ((await t.db.select().from(t.schema.timeEntry).where(eq(t.schema.timeEntry.id, id))) as any[])[0]
    const reset = async (who: string) => { await t.db.delete(t.schema.timeEntry).where(eq(t.schema.timeEntry.userId, ids[who])) }
    const setClock = async (timeClock: any) => {
      const [row] = (await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, co))) as any[]
      const settings = (typeof row.settings === 'string' ? JSON.parse(row.settings || '{}') : row.settings) || {}
      await t.db.update(t.schema.company).set({ settings: { ...settings, timeClock } } as any).where(eq(t.schema.company.id, co))
    }
    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
    const newJob = async (assignedToId: string | null) => (await as('owner', '/api/jobs', 'POST', { title: 'Furnace', contactId: customer, ...(assignedToId ? { assignedToId } : {}) })).body

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      co = s.company.id
      await features(FEATURES)
      ;(t.services as any).crm.sms.sendJobUpdate = async () => {}
      ;(t.services as any).phonePush.send = async (_co: string, to: string[], m: any) => { pushes.push({ to, title: m.title, body: m.body }); return to.length }
      const login = async (e: string, p: string) => ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } })).json()) as any).accessToken
      tok.owner = await login('owner@test.example', s.password)
      ids.owner = ((await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'owner@test.example'))) as any[])[0].id
      for (const [key, role] of Object.entries({ tia: 'field', sam: 'field', viewer: 'viewer' })) {
        const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: key, lastName: 'Seat', role, companyId: co })
        ids[key] = u.id
        tok[key] = await login(`${key}@test.example`, 'Seat-pass-1')
      }
      customer = (await as('owner', '/api/contacts', 'POST', { name: 'Pat', type: 'client' })).body.id
    }, 120_000)

    describe('breaks', () => {
      test('a break comes off the hours; one still running ends with the shift', async () => {
        await reset('tia')
        const inn = await as('tia', '/api/time/clock-in', 'POST', { at: ago(120) })
        expect(inn.status).toBe(201)
        expect((await as('tia', '/api/time/break/start', 'POST', { at: ago(90) })).status).toBe(200)
        // Already on one.
        const twice = await as('tia', '/api/time/break/start', 'POST', {})
        expect(twice.status).toBe(409)
        expect(twice.body.error).toBe('You are already on a break')
        expect((await as('tia', '/api/time/active')).body.breakStartedAt).not.toBeNull()
        const ended = await as('tia', '/api/time/break/end', 'POST', { at: ago(60) })
        expect(ended.status).toBe(200)
        expect(ended.body.breakMinutes).toBe(30)
        expect(ended.body.breakStartedAt).toBeNull()
        const out = await as('tia', '/api/time/clock-out', 'POST', {})
        expect(out.status).toBe(200)
        expect(Number(out.body.hours)).toBe(1.5) // 120 minutes in, 30 on a break
        expect(out.body.breakMinutes).toBe(30)

        const second = await as('tia', '/api/time/clock-in', 'POST', { at: ago(100) })
        await as('tia', '/api/time/break/start', 'POST', { at: ago(40) })
        const out2 = await as('tia', '/api/time/clock-out', 'POST', {})
        expect(Number(out2.body.hours)).toBe(1) // 100 minutes in, the last 40 on a break that ended with the shift
        expect(out2.body.breakMinutes).toBe(40)
        expect(second.status).toBe(201)
      })

      test('refused in words when there is nothing to take a break from', async () => {
        await reset('tia')
        const none = await as('tia', '/api/time/break/start', 'POST', {})
        expect(none.status).toBe(400)
        expect(none.body.error).toBe('Clock in before starting a break')
        await as('tia', '/api/time/clock-in', 'POST', {})
        const notOn = await as('tia', '/api/time/break/end', 'POST', {})
        expect(notOn.status).toBe(400)
        expect(notOn.body.error).toBe('You are not on a break')
        // A break that ends before it began, and a Viewer.
        await as('tia', '/api/time/break/start', 'POST', {})
        expect((await as('tia', '/api/time/break/end', 'POST', { at: ago(30) })).body.error).toBe('That time is before the break began.')
        expect((await as('viewer', '/api/time/break/start', 'POST', {})).status).toBe(403)
      })
    })

    describe('a GPS stamp and the "time set by the phone" mark', () => {
      test('each tap keeps where the phone was; one number alone is refused', async () => {
        await reset('tia')
        const inn = await as('tia', '/api/time/clock-in', 'POST', { place: { lat: 43.0731, lng: -89.4012 } })
        expect(inn.status).toBe(201)
        expect(inn.body.clockInLat).toBeCloseTo(43.0731, 3)
        expect(inn.body.clockInLng).toBeCloseTo(-89.4012, 3)
        const out = await as('tia', '/api/time/clock-out', 'POST', { at: new Date(Date.now() + 90_000).toISOString(), place: { lat: 43.08, lng: -89.41 } })
        // An entry under a minute is a mis-click and discarded; make it a real one.
        expect(out.status).toBe(200)
        await reset('tia')
        await as('tia', '/api/time/clock-in', 'POST', { at: ago(60), place: { lat: 1, lng: 2 } })
        const real = await as('tia', '/api/time/clock-out', 'POST', { place: { lat: 43.08, lng: -89.41 } })
        expect(real.body.clockOutLat).toBeCloseTo(43.08, 3)
        expect(real.body.clockInLat).toBe(1)
        const half = await as('tia', '/api/time/clock-in', 'POST', { place: { lat: 43.0 } })
        expect(half.status).toBe(400)
        const wrong = await as('tia', '/api/time/clock-in', 'POST', { place: { lat: 143, lng: 0 } })
        expect(wrong.status).toBe(400)
        // No place: nothing kept.
        await reset('tia')
        expect((await as('tia', '/api/time/clock-in', 'POST', {})).body.clockInLat).toBeNull()
      })

      test('a time a phone tap moved is marked; one that arrived on time is not', async () => {
        await reset('tia')
        const moved = await as('tia', '/api/time/clock-in', 'POST', { at: ago(45) })
        expect(moved.body.timeSetByPhone).toBe(true)
        await reset('tia')
        const onTime = await as('tia', '/api/time/clock-in', 'POST', { at: ago(1) })
        expect(onTime.body.timeSetByPhone).toBe(false)
        await reset('tia')
        const plain = await as('tia', '/api/time/clock-in', 'POST', {})
        expect(plain.body.timeSetByPhone).toBe(false)
        // The clock-out moved by a tap marks the entry too, and the list the approver reads carries it.
        const out = await as('tia', '/api/time/clock-out', 'POST', { at: new Date(Date.now() + 1.5 * MIN).toISOString() })
        expect(out.status).toBe(200)
        await reset('tia')
        await as('tia', '/api/time/clock-in', 'POST', { at: ago(180) })
        const done = await as('tia', '/api/time/clock-out', 'POST', { at: ago(10) })
        expect(done.body.timeSetByPhone).toBe(true)
        const list = await as('owner', '/api/time')
        const rows = Array.isArray(list.body) ? list.body : list.body.entries ?? list.body.data
        expect(rows.find((r: any) => r.id === done.body.id).timeSetByPhone).toBe(true)
      })

      test('a hand clock-in is not recorded as an automatic one', async () => {
        await reset('tia')
        const inn = await as('tia', '/api/time/clock-in', 'POST', {})
        expect((await entry(inn.body.id)).isAutoClocked).toBe(false)
      })
    })

    describe('automatic timekeeping', () => {
      test('Arrive starts the tech\'s timesheet and Complete ends it; On my way alone does not', async () => {
        await reset('tia')
        await setClock({ automatic: { mode: 'arrive' } })
        const j = await newJob(ids.tia)
        await as('tia', `/api/jobs/${j.id}/dispatch`, 'POST', {})
        expect((await as('tia', '/api/time/active')).body).toBeNull()
        await as('tia', `/api/jobs/${j.id}/start`, 'POST', { tappedAt: ago(20) })
        const open = (await as('tia', '/api/time/active')).body
        expect(open).not.toBeNull()
        expect(open.jobId).toBe(j.id)
        expect(open.clockSource).toBe('job')
        expect(open.isAutoClocked).toBe(true)
        // The tapped moment is the time kept.
        expect(Date.now() - new Date(open.clockIn).getTime()).toBeGreaterThan(19 * MIN)
        expect(open.timeSetByPhone).toBe(true)
        const done = await as('tia', `/api/jobs/${j.id}/complete`, 'POST', {})
        expect(done.status).toBe(200)
        expect((await as('tia', '/api/time/active')).body).toBeNull()
        const [closed] = (await t.db.select().from(t.schema.timeEntry).where(eq(t.schema.timeEntry.id, open.id))) as any[]
        expect(closed.clockOut).not.toBeNull()
        expect(Number(closed.hours)).toBeGreaterThan(0.3)
      })

      test('On my way starts it when that is the setting', async () => {
        await reset('tia')
        await setClock({ automatic: { mode: 'on_my_way' } })
        const j = await newJob(ids.tia)
        await as('tia', `/api/jobs/${j.id}/dispatch`, 'POST', {})
        const open = (await as('tia', '/api/time/active')).body
        expect(open?.jobId).toBe(j.id)
        // Start while already on the clock changes nothing (one timesheet, not two).
        await as('tia', `/api/jobs/${j.id}/start`, 'POST', {})
        expect((await t.db.select().from(t.schema.timeEntry).where(eq(t.schema.timeEntry.userId, ids.tia))) as any[]).toHaveLength(1)
      })

      test('off by default; the office dispatching, a tech not on the job, a clock started by hand — nobody is clocked or closed', async () => {
        await reset('tia'); await reset('sam'); await reset('owner')
        await setClock({ automatic: { mode: 'off' } })
        const a = await newJob(ids.tia)
        await as('tia', `/api/jobs/${a.id}/start`, 'POST', {})
        expect((await as('tia', '/api/time/active')).body).toBeNull()

        await setClock({ automatic: { mode: 'arrive' } })
        const b = await newJob(ids.tia)
        await as('owner', `/api/jobs/${b.id}/start`, 'POST', {})
        expect((await as('owner', '/api/time/active')).body).toBeNull()
        const c = await newJob(ids.tia)
        await as('sam', `/api/jobs/${c.id}/start`, 'POST', {})
        expect((await as('sam', '/api/time/active')).body).toBeNull()

        // A clock the tech started by hand is theirs to close.
        await reset('tia')
        await as('tia', '/api/time/clock-in', 'POST', {})
        const d = await newJob(ids.tia)
        await as('tia', `/api/jobs/${d.id}/start`, 'POST', {})
        await as('tia', `/api/jobs/${d.id}/complete`, 'POST', {})
        const still = (await as('tia', '/api/time/active')).body
        expect(still).not.toBeNull()
        expect(still.clockSource).not.toBe('job')
        await reset('tia')
      })

      test('the setting is read and changed through its own screen, by the owner only', async () => {
        const got = await as('owner', '/api/time-clock/settings')
        expect(got.status).toBe(200)
        const put = await as('owner', '/api/time-clock/settings', 'PUT', { automatic: { mode: 'on_my_way' }, overtime: { enabled: true, dailyHours: 8, weeklyHours: 40, warnMinutes: 30 }, kiosk: { enabled: false } })
        expect(put.status).toBe(200)
        expect(put.body.automatic.mode).toBe('on_my_way')
        expect((await as('tia', '/api/time-clock/settings', 'PUT', put.body)).status).toBe(403)
        const bad = await as('owner', '/api/time-clock/settings', 'PUT', { automatic: { mode: 'sometimes' }, overtime: { enabled: true, dailyHours: 99, weeklyHours: 40, warnMinutes: 30 }, kiosk: { enabled: false } })
        expect(bad.status).toBe(400)
        expect((await as('tia', '/api/time-clock/settings')).status).toBe(200)
      })
    })

    describe('overtime alerts', () => {
      test('near and over the daily limit: told once to the person and the managers; the office sees the list', async () => {
        await reset('tia'); await reset('sam')
        pushes.length = 0
        await setClock({ overtime: { enabled: true, dailyHours: 8, weeklyHours: 80, warnMinutes: 30 } })
        const open = await ins(t.schema.timeEntry, { userId: ids.tia, companyId: co, clockIn: new Date(Date.now() - 7.75 * 60 * MIN), date: new Date(), hours: '0' })
        // The open clock's date is the business day marker; use the same rule the clock uses.
        const via = await as('tia', '/api/time/active')
        expect(via.body.id).toBe(open.id)
        const pass = (t.services as any).crm.eventJobs.overtimePass as (now?: Date) => Promise<number>
        expect(await pass()).toBe(1)
        expect(pushes.some((p) => p.to.includes(ids.tia) && p.title === 'Almost overtime')).toBe(true)
        expect(pushes.some((p) => p.to.includes(ids.owner) && /tia Seat is close to the 8-hour daily limit/.test(p.body))).toBe(true)
        // Once: the same pass again says nothing.
        expect(await pass()).toBe(0)
        // Crossing the limit is a second, different alert.
        await t.db.update(t.schema.timeEntry).set({ clockIn: new Date(Date.now() - 8.5 * 60 * MIN) } as any).where(eq(t.schema.timeEntry.id, open.id))
        expect(await pass()).toBe(1)
        expect(pushes.some((p) => p.to.includes(ids.tia) && p.title === 'Overtime' && /8-hour limit/.test(p.body))).toBe(true)
        expect(await pass()).toBe(0)
        const list = await as('owner', '/api/time-clock/overtime')
        const row = list.body.people.find((r: any) => r.userId === ids.tia)
        expect(row.overDaily).toBe(true)
        expect(row.onTheClock).toBe(true)
        // A person sees only themselves.
        expect((await as('sam', '/api/time-clock/overtime')).body.people.every((r: any) => r.userId === ids.sam)).toBe(true)
        await reset('tia')
      })

      test('a break on the clock is not overtime; off, nobody is told', async () => {
        await reset('tia'); pushes.length = 0
        await setClock({ overtime: { enabled: true, dailyHours: 8, weeklyHours: 80, warnMinutes: 0 } })
        await ins(t.schema.timeEntry, { userId: ids.tia, companyId: co, clockIn: new Date(Date.now() - 9 * 60 * MIN), breakMinutes: 90, date: new Date(), hours: '0' })
        const pass = (t.services as any).crm.eventJobs.overtimePass as (now?: Date) => Promise<number>
        expect(await pass()).toBe(0) // 9 hours in, 1.5 on breaks = 7.5 worked
        await setClock({ overtime: { enabled: false, dailyHours: 1, weeklyHours: 1, warnMinutes: 0 } })
        expect(await pass()).toBe(0)
        expect(pushes).toHaveLength(0)
        await reset('tia')
      })
    })

    describe('the kiosk', () => {
      test('off by default; on, a manager\'s tablet clocks whoever types their own PIN', async () => {
        await reset('tia')
        await setClock({ kiosk: { enabled: false } })
        expect((await as('tia', '/api/time-clock/kiosk/pin', 'PUT', { pin: '2468' })).status).toBe(200)
        expect((await as('tia', '/api/time-clock/kiosk/pin')).body.hasPin).toBe(true)
        const off = await as('owner', '/api/time-clock/kiosk/punch', 'POST', { pin: '2468' })
        expect(off.status).toBe(403)
        expect(off.body.error).toContain('switched off')

        await setClock({ kiosk: { enabled: true } })
        const inn = await as('owner', '/api/time-clock/kiosk/punch', 'POST', { pin: '2468' })
        expect(inn.status).toBe(200)
        expect(inn.body.action).toBe('in')
        expect(inn.body.name).toBe('tia Seat')
        const open = (await as('tia', '/api/time/active')).body
        expect(open.clockSource).toBe('kiosk')
        // A break from the tablet, then out.
        expect((await as('owner', '/api/time-clock/kiosk/punch', 'POST', { pin: '2468', break: true })).body.action).toBe('break_start')
        expect((await as('owner', '/api/time-clock/kiosk/punch', 'POST', { pin: '2468', break: true })).body.action).toBe('break_end')
        await t.db.update(t.schema.timeEntry).set({ clockIn: new Date(Date.now() - 60 * MIN) } as any).where(eq(t.schema.timeEntry.id, open.id))
        const out = await as('owner', '/api/time-clock/kiosk/punch', 'POST', { pin: '2468' })
        expect(out.body.action).toBe('out')
        expect((await as('tia', '/api/time/active')).body).toBeNull()
      })

      test('a field seat\'s own sign-in cannot run the tablet; two people cannot share a PIN; five wrong PINs stop it', async () => {
        await setClock({ kiosk: { enabled: true } })
        expect((await as('tia', '/api/time-clock/kiosk/punch', 'POST', { pin: '2468' })).status).toBe(403)
        const clash = await as('sam', '/api/time-clock/kiosk/pin', 'PUT', { pin: '2468' })
        expect(clash.status).toBe(409)
        expect(clash.body.error).toBe('Somebody here already uses that PIN. Pick another.')
        expect((await as('sam', '/api/time-clock/kiosk/pin', 'PUT', { pin: '12' })).body.error).toBe('A PIN is 4 to 8 digits.')
        for (let i = 0; i < 5; i++) expect((await as('owner', '/api/time-clock/kiosk/punch', 'POST', { pin: '9999' })).body.error).toBe("That PIN didn't match anyone.")
        const stopped = await as('owner', '/api/time-clock/kiosk/punch', 'POST', { pin: '2468' })
        expect(stopped.status).toBe(429)
        expect(stopped.body.error).toBe('Too many wrong PINs. Wait a few minutes.')
      })
    })

    describe('the geofence\'s automatic clock-out', () => {
      test('leaving the job-site fence clocks the tech out with the break taken off and the place kept', async () => {
        await reset('tia')
        await setClock({})
        const fence = await as('owner', '/api/geofencing', 'POST', { name: 'Lee house', lat: 44.5, lng: -88.0, radius: 100 })
        expect(fence.status).toBe(201)
        expect((await as('tia', '/api/geofencing/settings', 'PUT', { locationTrackingEnabled: true, autoClockEnabled: true })).status).toBe(200)
        const arrive = await as('tia', '/api/geofencing/location', 'POST', { lat: 44.5, lng: -88.0, accuracy: 8 })
        expect(arrive.body.actions.some((a: any) => a.type === 'clock_in')).toBe(true)
        const open = (await as('tia', '/api/time/active')).body
        expect(open.isAutoClocked).toBe(true)
        expect(open.clockSource).toBe('geofence')
        expect(open.clockInLat).toBeCloseTo(44.5, 3)
        // Two hours in, a half-hour break, then walks away.
        await t.db.update(t.schema.timeEntry).set({ clockIn: new Date(Date.now() - 120 * MIN), breakMinutes: 30 } as any).where(eq(t.schema.timeEntry.id, open.id))
        const leave = await as('tia', '/api/geofencing/location', 'POST', { lat: 44.6, lng: -88.1, accuracy: 8 })
        expect(leave.status).toBe(200)
        const out = leave.body.actions.find((a: any) => a.type === 'clock_out')
        expect(out).toBeTruthy()
        expect((await as('tia', '/api/time/active')).body).toBeNull()
        const done = await entry(open.id)
        expect(done.clockOut).not.toBeNull()
        expect(Number(done.hours)).toBe(1.5)
        expect(done.clockOutLat).toBeCloseTo(44.6, 3)
      })
    })
  })
}
