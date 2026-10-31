// Item 7 of the field-service depth brief: working hours and time off per tech (server/data/techAvailability.ts,
// /api/availability), shown on the Dispatch Board and checked when a job is given to someone. Through the real server and
// the real login, on BOTH field service and basic.
//   · a tech with NO hours set is never warned about — a business that has not set anyone up works as it did;
//   · hours: a day with no window is a day off, a job outside the window warns; time off (whole days, or part of one) warns;
//   · it is a WARNING the office may book past ("Book anyway", recorded in the audit log), on create and on a move —
//     the same answer a travel-time warning gives; an overlap is still a refusal;
//   · roster-only crew can be given hours and time off too;
//   · the Dispatch Board's day view lists who is off / away / on hours, with no notes;
//   · the doors: editing is jobs:dispatch, the day view is jobs:read; closed (and no warning) while the feature is off.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'jobs', 'dispatch_board', 'tech_availability']
// 2026-11-04 is a Wednesday; the 7th a Saturday; the 10th a Tuesday.
const WED = '2026-11-04', SAT = '2026-11-07', TUE_OFF = '2026-11-10', TUE_PART = '2026-11-11'

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let co = ''
    // A new job is for a customer in these trades (contractor PR #173: crm.jobs.requireCustomer).
    let customer = ''
    const tok: Record<string, string> = {}
    const id: Record<string, string> = {}
    const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
      const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tok[who]}` } })
      const text = await r.text(); let body: any = text
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      return { status: r.status, body }
    }
    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
    const job = (fields: Record<string, unknown>) => as('owner', '/api/jobs', 'POST', { title: 'Furnace', estimatedHours: 1, contactId: customer, ...fields })
    const WORK_WEEK = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startsAt: '08:00', endsAt: '16:00' }))

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      co = s.company.id
      await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, co))
      await features(FEATURES)
      const login = async (e: string, p: string) => ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } })).json()) as any).accessToken
      tok.owner = await login('owner@test.example', s.password)
      customer = ((await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Pat Customer', type: 'client' } as any).returning()) as any[])[0].id
      for (const [key, role] of Object.entries({ tia: 'field', manager: 'manager', field: 'field', viewer: 'viewer' })) {
        const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: key === 'tia' ? 'Tia' : key, lastName: 'Tech', role, companyId: co } as any).returning()
        id[key] = u.id; tok[key] = await login(`${key}@test.example`, 'Seat-pass-1')
      }
      id.rob = (await t.db.insert(t.schema.teamMember).values({ companyId: co, name: 'Rob Roster', active: true } as any).returning())[0].id
      id.ann = (await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Ann Able', type: 'client' } as any).returning())[0].id
    }, 120_000)

    describe('the doors', () => {
      test('editing is jobs:dispatch; a Staff or Viewer seat is refused; the day view is jobs:read', async () => {
        for (const who of ['field', 'viewer']) {
          expect((await as(who, '/api/availability')).status).toBe(403)
          expect((await as(who, `/api/availability/hours/${id.tia}`, 'PUT', { days: WORK_WEEK })).status).toBe(403)
          expect((await as(who, '/api/availability/time-off', 'POST', { personId: id.tia, from: TUE_OFF, to: TUE_OFF })).status).toBe(403)
          expect((await as(who, '/api/availability/time-off/x', 'DELETE')).status).toBe(403)
        }
        expect((await as('field', `/api/availability/day?date=${WED}`)).status).toBe(200)
        expect((await as('manager', '/api/availability')).status).toBe(200)
        expect((await t.call('/api/availability')).status).toBe(401)
      })

      test('not ready: closed to a business that does not have it', async () => {
        await features(FEATURES.filter((f) => f !== 'tech_availability'))
        try { for (const p of ['/api/availability', `/api/availability/day?date=${WED}`]) expect([403, 404]).toContain((await as('owner', p)).status) }
        finally { await features(FEATURES) }
      })

      test('hours and time off are validated by field', async () => {
        const bad = await as('owner', `/api/availability/hours/${id.tia}`, 'PUT', { days: [{ weekday: 1, startsAt: '16:00', endsAt: '08:00' }, { weekday: 1, startsAt: '08:00', endsAt: '09:00' }] })
        expect(bad.status).toBe(400); expect(bad.body.fields['days.0.endsAt']).toBeTruthy(); expect(bad.body.fields['days.1.weekday']).toBeTruthy()
        expect((await as('owner', `/api/availability/hours/${id.tia}`, 'PUT', { days: [{ weekday: 9, startsAt: '08:00', endsAt: '09:00' }] })).status).toBe(400)
        expect((await as('owner', `/api/availability/hours/nobody`, 'PUT', { days: [] })).status).toBe(404)
        const off = (b: any) => as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, ...b })
        expect((await off({ from: '2026-11-12', to: '2026-11-10' })).body.fields.to).toBeTruthy()
        expect((await off({ from: TUE_OFF, to: TUE_OFF, startTime: '12:00' })).body.fields.endTime).toBeTruthy()
        expect((await off({ from: TUE_OFF, to: '2026-11-12', startTime: '12:00', endTime: '14:00' })).body.fields.to).toBeTruthy()
        expect((await off({ from: TUE_OFF, to: TUE_OFF, startTime: '14:00', endTime: '12:00' })).body.fields.endTime).toBeTruthy()
        expect((await as('owner', '/api/availability/time-off', 'POST', { personId: 'nobody', from: TUE_OFF, to: TUE_OFF })).status).toBe(404)
      })
    })

    describe('a job given to someone who is away', () => {
      test('nobody set up: never warned, whatever the day', async () => {
        const r = await job({ scheduledDate: SAT, scheduledTime: '03:00', assignedToId: id.tia, contactId: id.ann })
        expect(r.status).toBe(201)
        await as('owner', `/api/jobs/${r.body.id}`, 'DELETE')
      })

      test('set up: inside the hours is fine; a day off, and outside the hours, warn — and can be booked anyway, on the record', async () => {
        expect((await as('owner', `/api/availability/hours/${id.tia}`, 'PUT', { days: WORK_WEEK })).status).toBe(200)
        expect((await job({ scheduledDate: WED, scheduledTime: '09:00', assignedToId: id.tia })).status).toBe(201)

        const sat = await job({ scheduledDate: SAT, scheduledTime: '09:00', assignedToId: id.tia })
        expect(sat.status).toBe(409)
        expect(sat.body).toMatchObject({ code: 'unavailable', canBookAnyway: true })
        expect(sat.body.error).toContain('Tia Tech does not work Saturdays.')

        const late = await job({ scheduledDate: WED, scheduledTime: '15:30', assignedToId: id.tia })
        expect(late.status).toBe(409)
        expect(late.body.error).toContain('works 8:00 am–4:00 pm on Wednesdays')
        expect((await job({ scheduledDate: WED, scheduledTime: '07:00', assignedToId: id.tia })).status).toBe(409)

        const booked = await job({ scheduledDate: SAT, scheduledTime: '09:00', assignedToId: id.tia, bookAnyway: true })
        expect(booked.status).toBe(201)
        const rows = await t.db.select().from(t.schema.auditLog).where(and(eq(t.schema.auditLog.companyId, co), eq(t.schema.auditLog.action, 'book_anyway')))
        const mine = rows.find((r: any) => r.entityId === booked.body.id)
        expect(mine).toBeTruthy()
        expect(JSON.stringify(mine?.metadata)).toContain('hours')
      })

      test('a job with only a day is checked against days off, not hours', async () => {
        expect((await job({ scheduledDate: WED, assignedToId: id.tia })).status).toBe(201)
        expect((await job({ scheduledDate: SAT, assignedToId: id.tia })).status).toBe(409)
      })

      test('time off: a whole day warns whatever the hours; part of a day warns only inside it', async () => {
        const whole = await as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, from: TUE_OFF, to: TUE_OFF, note: 'Dentist' })
        expect(whole.status).toBe(201)
        const w = await job({ scheduledDate: TUE_OFF, scheduledTime: '10:00', assignedToId: id.tia })
        expect(w.status).toBe(409); expect(w.body.error).toContain('Tia Tech is off on Nov 10 (Dentist).')
        expect((await job({ scheduledDate: TUE_OFF, assignedToId: id.tia })).status).toBe(409)

        expect((await as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, from: TUE_PART, to: TUE_PART, startTime: '12:00', endTime: '14:00' })).status).toBe(201)
        expect((await job({ scheduledDate: TUE_PART, scheduledTime: '13:00', assignedToId: id.tia })).status).toBe(409)
        expect((await job({ scheduledDate: TUE_PART, scheduledTime: '11:30', assignedToId: id.tia })).status).toBe(409) // 11:30–12:30 reaches into it
        expect((await job({ scheduledDate: TUE_PART, scheduledTime: '14:00', assignedToId: id.tia })).status).toBe(201)
        expect((await job({ scheduledDate: TUE_PART, scheduledTime: '09:00', assignedToId: id.tia })).status).toBe(201)

        // a range of days
        const range = await as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, from: '2026-11-16', to: '2026-11-18' })
        expect(range.status).toBe(201)
        expect((await job({ scheduledDate: '2026-11-17', scheduledTime: '09:00', assignedToId: id.tia })).status).toBe(409)
        expect((await job({ scheduledDate: '2026-11-19', scheduledTime: '09:00', assignedToId: id.tia })).status).toBe(201)
        expect((await as('owner', `/api/availability/time-off/${range.body.id}`, 'DELETE')).status).toBe(200)
        expect((await job({ scheduledDate: '2026-11-17', scheduledTime: '09:00', assignedToId: id.tia })).status).toBe(201)
        expect((await as('owner', `/api/availability/time-off/${range.body.id}`, 'DELETE')).status).toBe(404)
      })

      test('moving an existing job onto a day off warns too, and booking anyway moves it', async () => {
        const j = await job({ scheduledDate: WED, scheduledTime: '10:30', assignedToId: id.tia })
        expect(j.status).toBe(201)
        const move = await as('owner', `/api/jobs/${j.body.id}`, 'PUT', { scheduledDate: '2026-11-08', scheduledTime: '10:30' }) // Sunday
        expect(move.status).toBe(409); expect(move.body.code).toBe('unavailable')
        const forced = await as('owner', `/api/jobs/${j.body.id}`, 'PUT', { scheduledDate: '2026-11-08', scheduledTime: '10:30', bookAnyway: true })
        expect(forced.status).toBe(200)
        // a change that does not move the visit is not asked again
        expect((await as('owner', `/api/jobs/${j.body.id}`, 'PUT', { notes: 'bring the filter' })).status).toBe(200)
      })

      test('roster-only crew have hours and time off like anyone', async () => {
        expect((await as('owner', `/api/availability/hours/${id.rob}`, 'PUT', { days: WORK_WEEK })).status).toBe(200)
        const sat = await job({ scheduledDate: SAT, scheduledTime: '09:00', assignedToMemberId: id.rob })
        expect(sat.status).toBe(409); expect(sat.body.error).toContain('Rob Roster does not work Saturdays.')
        expect((await job({ scheduledDate: WED, scheduledTime: '09:00', assignedToMemberId: id.rob })).status).toBe(201)
      })

      test('a helper on the job counts, not only the lead', async () => {
        const r = await job({ scheduledDate: SAT, scheduledTime: '11:00', assignedToId: id.manager, otherAssigneeIds: [id.tia] })
        // the lead has no hours; Tia (a helper) is off on Saturday
        expect(r.status).toBe(409)
        expect(r.body).toMatchObject({ code: 'unavailable' }); expect(r.body.error).toContain('Tia Tech')
      })

      test('switched off: no warning at all, the hours stay stored', async () => {
        await features(FEATURES.filter((f) => f !== 'tech_availability'))
        try { expect((await job({ scheduledDate: SAT, scheduledTime: '12:00', assignedToId: id.tia })).status).toBe(201) }
        finally { await features(FEATURES) }
        expect((await as('owner', '/api/availability')).body.people.length).toBeGreaterThan(0)
      })
    })

    describe('the Dispatch Board’s day', () => {
      test('who is off, partly away, or on hours; nobody set up is listed; no notes', async () => {
        const day = async (d: string) => (await as('field', `/api/availability/day?date=${d}`)).body.people as any[]
        const sat = (await day(SAT)).find((p) => p.personId === id.tia)
        expect(sat).toMatchObject({ state: 'off', label: "Doesn't work Saturdays", kind: 'user' })
        expect((await day(TUE_OFF)).find((p) => p.personId === id.tia)).toMatchObject({ state: 'off', label: 'Off today' })
        expect((await day(TUE_PART)).find((p) => p.personId === id.tia)).toMatchObject({ state: 'part', label: 'Away 12:00 pm–2:00 pm' })
        expect((await day(WED)).find((p) => p.personId === id.tia)).toMatchObject({ state: 'hours', label: '8:00 am–4:00 pm' })
        expect((await day(SAT)).find((p) => p.personId === id.rob)?.kind).toBe('member')
        expect((await day(WED)).some((p) => p.personId === id.manager)).toBe(false)
        expect(JSON.stringify(await day(TUE_OFF))).not.toContain('Dentist')
        expect((await as('field', '/api/availability/day?date=soon')).status).toBe(400)
      })

      test('the editing page lists hours and the time off still to come, with the note', async () => {
        const mine = (await as('manager', '/api/availability')).body.people.find((p: any) => p.personId === id.tia)
        expect(mine.hours.length).toBe(5)
        expect(mine.timeOff.some((o: any) => o.note === 'Dentist' && o.from === TUE_OFF)).toBe(true)
      })

      test('clearing the hours puts a tech back to available any time', async () => {
        expect((await as('owner', `/api/availability/hours/${id.rob}`, 'PUT', { days: [] })).status).toBe(200)
        expect((await job({ scheduledDate: SAT, scheduledTime: '09:00', assignedToMemberId: id.rob })).status).toBe(201)
      })
    })
  })
}
