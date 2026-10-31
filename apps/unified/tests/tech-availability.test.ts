// Item 7 of the field-service depth brief, finished by item 8 of the parity brief: working hours and time off per tech
// (server/data/techAvailability.ts, /api/availability), shown on the Dispatch Board and checked when a job is given to
// someone. Through the real server and the real login, on BOTH field service and basic.
//   · a tech with NO hours set is never warned about — a business that has not set anyone up works as it did;
//   · hours: a day with no window is a day off, a job outside the window warns; time off (whole days, or part of one) warns;
//   · it is a WARNING the office may book past ("Book anyway", recorded in the audit log), on create and on a move —
//     the same answer a travel-time warning gives; an overlap is still a refusal;
//   · roster-only crew can be given hours and time off too;
//   · the Dispatch Board's day view lists who is off / away / on hours, with no notes;
//   · the doors: editing is jobs:dispatch, the day view is jobs:read; closed (and no warning) while the feature is off.
// Item 8 (ServiceTitan shifts, Jobber Find a Time):
//   · split shifts (two windows a day), overnight shifts (crossing midnight), on-call shifts, a pattern with a start and
//     end date; copy one person's shifts to others; clear several people's at once;
//   · Find a time: open slots inside shifts (or the business's hours), around booked jobs and the drive between them,
//     for one person or anyone, never over time off, never before now — the function a later item books through;
//   · time off that makes timesheet entries (one a day, the day's regular hours; part of a day that long), removed with
//     it unless approved;
//   · a repeating series checked visit by visit against hours and time off;
//   · the day view's bars for the board's time axis: regular, on call and time off apart.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'jobs', 'dispatch_board', 'tech_availability', 'time_tracking']
// 2026-11-04 is a Wednesday; the 7th a Saturday; the 10th a Tuesday.
const WED = '2026-11-04', SAT = '2026-11-07', TUE_OFF = '2026-11-10', TUE_PART = '2026-11-11'
// December 2026: the 7th is a Monday, the 9th a Wednesday, the 11th a Friday, the 12th a Saturday, the 13th a Sunday.
const D_WED = '2026-12-09', D_FRI = '2026-12-11', D_SAT = '2026-12-12', D_SUN = '2026-12-13'

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
    const businessHours = async (hours: Record<string, { open: string; close: string }> | null) => {
      await t.db.update(t.schema.company).set({ settings: hours ? { businessHours: hours } : {} } as any).where(eq(t.schema.company.id, co))
    }

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      co = s.company.id
      await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, co))
      await features(FEATURES)
      const login = async (e: string, p: string) => ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } })).json()) as any).accessToken
      tok.owner = await login('owner@test.example', s.password)
      customer = ((await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Pat Customer', type: 'client' } as any).returning()) as any[])[0].id
      for (const [key, role] of Object.entries({ tia: 'field', manager: 'manager', field: 'field', viewer: 'viewer', sam: 'field', fay: 'field' })) {
        const names: Record<string, string> = { tia: 'Tia', sam: 'Sam', fay: 'Fay' }
        const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: names[key] || key, lastName: 'Tech', role, companyId: co } as any).returning()
        id[key] = u.id; tok[key] = await login(`${key}@test.example`, 'Seat-pass-1')
      }
      id.rob = (await t.db.insert(t.schema.teamMember).values({ companyId: co, name: 'Rob Roster', active: true } as any).returning())[0].id
      id.ann = (await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Ann Able', type: 'client' } as any).returning())[0].id
    }, 120_000)

    describe('the doors', () => {
      test('editing is jobs:dispatch; a Staff or Viewer seat is refused; the day view and Find a time are jobs:read', async () => {
        for (const who of ['field', 'viewer']) {
          expect((await as(who, '/api/availability')).status).toBe(403)
          expect((await as(who, `/api/availability/hours/${id.tia}`, 'PUT', { shifts: WORK_WEEK })).status).toBe(403)
          expect((await as(who, '/api/availability/hours/copy', 'POST', { fromPersonId: id.tia, toPersonIds: [id.sam] })).status).toBe(403)
          expect((await as(who, '/api/availability/hours/clear', 'POST', { personIds: [id.tia] })).status).toBe(403)
          expect((await as(who, '/api/availability/time-off', 'POST', { personId: id.tia, from: TUE_OFF, to: TUE_OFF })).status).toBe(403)
          expect((await as(who, '/api/availability/time-off/x', 'DELETE')).status).toBe(403)
        }
        expect((await as('field', `/api/availability/day?date=${WED}`)).status).toBe(200)
        expect((await as('field', `/api/availability/find?from=${WED}&duration=60`)).status).toBe(200)
        expect((await as('manager', '/api/availability')).status).toBe(200)
        expect((await t.call('/api/availability')).status).toBe(401)
        expect((await t.call(`/api/availability/find?from=${WED}&duration=60`)).status).toBe(401)
      })

      test('not ready: closed to a business that does not have it', async () => {
        await features(FEATURES.filter((f) => f !== 'tech_availability'))
        try { for (const p of ['/api/availability', `/api/availability/day?date=${WED}`, `/api/availability/find?from=${WED}&duration=60`]) expect([403, 404]).toContain((await as('owner', p)).status) }
        finally { await features(FEATURES) }
      })

      test('shifts and time off are validated by field', async () => {
        const put = (shifts: unknown) => as('owner', `/api/availability/hours/${id.tia}`, 'PUT', { shifts })
        const bad = await put([{ weekday: 1, startsAt: '16:00', endsAt: '08:00' }, { weekday: 1, startsAt: '08:00', endsAt: '12:00' }, { weekday: 1, startsAt: '11:00', endsAt: '13:00' }])
        expect(bad.status).toBe(400); expect(bad.body.fields['shifts.0.endsAt']).toBeTruthy(); expect(bad.body.fields['shifts.2.startsAt']).toBe('Overlaps another shift that day')
        // an overnight shift ends before the time it started; a dated pattern ends after it starts
        expect((await put([{ weekday: 1, startsAt: '22:00', endsAt: '23:00', endsNextDay: true }])).body.fields['shifts.0.endsAt']).toBeTruthy()
        expect((await put([{ weekday: 1, startsAt: '08:00', endsAt: '12:00', from: '2026-12-10', to: '2026-12-01' }])).body.fields['shifts.0.to']).toBeTruthy()
        expect((await put([{ weekday: 1, startsAt: '08:00', endsAt: '12:00', kind: 'night' }])).body.fields['shifts.0.kind']).toBeTruthy()
        expect((await put([{ weekday: 9, startsAt: '08:00', endsAt: '09:00' }])).status).toBe(400)
        // two patterns on the same weekday that never meet in time are not an overlap
        expect((await put([{ weekday: 1, startsAt: '08:00', endsAt: '12:00', to: '2026-11-30' }, { weekday: 1, startsAt: '10:00', endsAt: '14:00', from: '2026-12-01' }])).status).toBe(200)
        expect((await put([])).status).toBe(200)
        // the first round's `days` list is still taken
        expect((await as('owner', `/api/availability/hours/${id.tia}`, 'PUT', { days: WORK_WEEK })).status).toBe(200)
        expect((await put([])).status).toBe(200)
        expect((await as('owner', `/api/availability/hours/nobody`, 'PUT', { shifts: [] })).status).toBe(404)
        const off = (b: any) => as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, ...b })
        expect((await off({ from: '2026-11-12', to: '2026-11-10' })).body.fields.to).toBeTruthy()
        expect((await off({ from: TUE_OFF, to: TUE_OFF, startTime: '12:00' })).body.fields.endTime).toBeTruthy()
        expect((await off({ from: TUE_OFF, to: '2026-11-12', startTime: '12:00', endTime: '14:00' })).body.fields.to).toBeTruthy()
        expect((await off({ from: TUE_OFF, to: TUE_OFF, startTime: '14:00', endTime: '12:00' })).body.fields.endTime).toBeTruthy()
        expect((await off({ from: '2026-11-01', to: '2027-03-01' })).body.fields.to).toBeTruthy()
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
        expect((await as('owner', `/api/availability/hours/${id.tia}`, 'PUT', { shifts: WORK_WEEK })).status).toBe(200)
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
        expect((await as('owner', `/api/availability/hours/${id.rob}`, 'PUT', { shifts: WORK_WEEK })).status).toBe(200)
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
        expect((await day(TUE_OFF)).find((p) => p.personId === id.tia)).toMatchObject({ state: 'off', label: 'Off today', bars: [{ startMin: 0, endMin: 1440, kind: 'off' }] })
        expect((await day(TUE_PART)).find((p) => p.personId === id.tia)).toMatchObject({ state: 'part', label: 'Away 12:00 pm–2:00 pm' })
        expect((await day(TUE_PART)).find((p) => p.personId === id.tia).bars).toEqual([{ startMin: 480, endMin: 960, kind: 'regular' }, { startMin: 720, endMin: 840, kind: 'off' }])
        expect((await day(WED)).find((p) => p.personId === id.tia)).toMatchObject({ state: 'hours', label: '8:00 am–4:00 pm', bars: [{ startMin: 480, endMin: 960, kind: 'regular' }] })
        expect((await day(SAT)).find((p) => p.personId === id.rob)?.kind).toBe('member')
        expect((await day(WED)).some((p) => p.personId === id.manager)).toBe(false)
        expect(JSON.stringify(await day(TUE_OFF))).not.toContain('Dentist')
        expect((await as('field', '/api/availability/day?date=soon')).status).toBe(400)
      })

      test('the editing page lists shifts and the time off still to come, with the note', async () => {
        const mine = (await as('manager', '/api/availability')).body.people.find((p: any) => p.personId === id.tia)
        expect(mine.shifts.length).toBe(5)
        expect(mine.shifts[0]).toMatchObject({ weekday: 1, startsAt: '08:00', endsAt: '16:00', kind: 'regular', endsNextDay: false, from: null, to: null })
        expect(mine.timeOff.some((o: any) => o.note === 'Dentist' && o.from === TUE_OFF && o.timesheet === false)).toBe(true)
      })

      test('clearing the hours puts a tech back to available any time', async () => {
        expect((await as('owner', `/api/availability/hours/${id.rob}`, 'PUT', { shifts: [] })).status).toBe(200)
        expect((await job({ scheduledDate: SAT, scheduledTime: '09:00', assignedToMemberId: id.rob })).status).toBe(201)
      })
    })

    describe('shift kinds (ServiceTitan)', () => {
      const SPLIT = [1, 2, 3, 4, 5].flatMap((weekday) => [{ weekday, startsAt: '08:00', endsAt: '12:00' }, { weekday, startsAt: '13:00', endsAt: '17:00' }])
      const day = async (d: string, who: string) => ((await as('field', `/api/availability/day?date=${d}`)).body.people as any[]).find((p) => p.personId === who)

      test('a split shift: two windows a day; a job across the gap warns, one in either half is fine', async () => {
        expect((await as('owner', `/api/availability/hours/${id.sam}`, 'PUT', { shifts: SPLIT })).status).toBe(200)
        const gap = await job({ scheduledDate: D_WED, scheduledTime: '12:30', assignedToId: id.sam })
        expect(gap.status).toBe(409)
        expect(gap.body.error).toContain('Sam Tech works 8:00 am–12:00 pm and 1:00 pm–5:00 pm on Wednesdays')
        expect((await job({ scheduledDate: D_WED, scheduledTime: '09:00', assignedToId: id.sam })).status).toBe(201)
        expect((await job({ scheduledDate: D_WED, scheduledTime: '13:00', assignedToId: id.sam })).status).toBe(201)
        expect(await day(D_WED, id.sam)).toMatchObject({ state: 'hours', label: '8:00 am–12:00 pm and 1:00 pm–5:00 pm', bars: [{ startMin: 480, endMin: 720, kind: 'regular' }, { startMin: 780, endMin: 1020, kind: 'regular' }] })
      })

      test('an overnight shift crosses midnight: it covers the small hours of the next day', async () => {
        expect((await as('owner', `/api/availability/hours/${id.sam}`, 'PUT', { shifts: [...SPLIT, { weekday: 5, startsAt: '22:00', endsAt: '06:00', endsNextDay: true }] })).status).toBe(200)
        expect((await job({ scheduledDate: D_FRI, scheduledTime: '23:30', assignedToId: id.sam })).status).toBe(201) // 23:30–00:30
        expect((await job({ scheduledDate: D_SAT, scheduledTime: '02:00', assignedToId: id.sam })).status).toBe(201) // the tail, on Saturday
        const morning = await job({ scheduledDate: D_SAT, scheduledTime: '07:00', assignedToId: id.sam })
        expect(morning.status).toBe(409); expect(morning.body.error).toContain('works 12:00 am–6:00 am on Saturdays')
        expect((await day(D_FRI, id.sam)).bars).toContainEqual({ startMin: 1320, endMin: 1440, kind: 'regular' })
        expect(await day(D_SAT, id.sam)).toMatchObject({ state: 'hours', bars: [{ startMin: 0, endMin: 360, kind: 'regular' }] })
      })

      test('an on-call shift: bookable, drawn apart on the board', async () => {
        expect((await as('owner', `/api/availability/hours/${id.sam}`, 'PUT', { shifts: [...SPLIT, { weekday: 0, startsAt: '08:00', endsAt: '20:00', kind: 'on_call' }] })).status).toBe(200)
        expect((await job({ scheduledDate: D_SUN, scheduledTime: '10:00', assignedToId: id.sam })).status).toBe(201)
        expect((await job({ scheduledDate: D_SUN, scheduledTime: '21:00', assignedToId: id.sam })).status).toBe(409)
        expect(await day(D_SUN, id.sam)).toMatchObject({ state: 'hours', label: 'On call 8:00 am–8:00 pm', bars: [{ startMin: 480, endMin: 1200, kind: 'on_call' }] })
      })

      test('a recurring pattern with a start and end date runs only between them', async () => {
        expect((await as('owner', `/api/availability/hours/${id.sam}`, 'PUT', { shifts: [...SPLIT, { weekday: 6, startsAt: '09:00', endsAt: '13:00', from: '2026-12-05', to: '2026-12-19' }] })).status).toBe(200)
        expect((await job({ scheduledDate: D_SAT, scheduledTime: '10:00', assignedToId: id.sam })).status).toBe(201)
        const after = await job({ scheduledDate: '2026-12-26', scheduledTime: '10:00', assignedToId: id.sam })
        expect(after.status).toBe(409); expect(after.body.error).toContain('Sam Tech has no shift on Dec 26.')
        expect((await job({ scheduledDate: '2026-11-28', scheduledTime: '10:00', assignedToId: id.sam })).status).toBe(409)
        expect(await day('2026-12-26', id.sam)).toMatchObject({ state: 'off', label: 'No shift today', bars: [] })
        const mine = (await as('manager', '/api/availability')).body.people.find((p: any) => p.personId === id.sam)
        expect(mine.shifts.find((s: any) => s.weekday === 6)).toMatchObject({ from: '2026-12-05', to: '2026-12-19' })
      })

      test('copy one person’s shifts to others, replacing theirs; clear several people’s at once', async () => {
        expect((await as('owner', '/api/availability/hours/copy', 'POST', { fromPersonId: id.sam, toPersonIds: [id.sam] })).status).toBe(400)
        expect((await as('owner', '/api/availability/hours/copy', 'POST', { fromPersonId: 'nobody', toPersonIds: [id.manager] })).status).toBe(404)
        const copied = await as('owner', '/api/availability/hours/copy', 'POST', { fromPersonId: id.sam, toPersonIds: [id.manager, id.rob] })
        expect(copied.status).toBe(200); expect(copied.body.message).toBe('11 shifts copied to 2 people.')
        const people = (await as('manager', '/api/availability')).body.people
        expect(people.find((p: any) => p.personId === id.manager).shifts.length).toBe(11)
        expect(people.find((p: any) => p.personId === id.rob).shifts.length).toBe(11)
        expect((await job({ scheduledDate: D_WED, scheduledTime: '12:30', assignedToId: id.manager })).status).toBe(409)
        expect((await job({ scheduledDate: D_WED, scheduledTime: '12:30', assignedToMemberId: id.rob })).status).toBe(409)

        const cleared = await as('owner', '/api/availability/hours/clear', 'POST', { personIds: [id.manager, id.rob] })
        expect(cleared.status).toBe(200); expect(cleared.body.message).toBe('22 shifts cleared for 2 people.')
        expect((await job({ scheduledDate: D_WED, scheduledTime: '12:30', assignedToId: id.manager })).status).toBe(201)
        expect((await job({ scheduledDate: D_WED, scheduledTime: '12:30', assignedToMemberId: id.rob })).status).toBe(201)
        expect((await as('manager', '/api/availability')).body.people.some((p: any) => p.personId === id.manager && p.shifts.length)).toBe(false)
        expect((await as('owner', '/api/availability/hours/clear', 'POST', { personIds: [] })).status).toBe(400)
        expect((await as('owner', '/api/availability/hours/clear', 'POST', { personIds: ['nobody'] })).status).toBe(404)
      })
    })

    describe('Find a time (Jobber)', () => {
      const FAY = [1, 2, 3, 4, 5].flatMap((weekday) => [{ weekday, startsAt: '08:00', endsAt: '12:00' }, { weekday, startsAt: '13:00', endsAt: '17:00' }])
      const find = (q: Record<string, string | number>, who = 'owner') => as(who, `/api/availability/find?${new URLSearchParams(Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)]))).toString()}`)
      const starts = (slots: any[], date: string) => slots.filter((s) => s.date === date).map((s) => s.startsAt)

      test('slots on the grid inside the shifts, for the length asked', async () => {
        expect((await as('owner', `/api/availability/hours/${id.fay}`, 'PUT', { shifts: [...FAY, { weekday: 6, startsAt: '08:00', endsAt: '12:00', kind: 'on_call' }] })).status).toBe(200)
        const r = await find({ from: D_WED, days: 1, duration: 60, personIds: id.fay })
        expect(r.status).toBe(200)
        expect(r.body).toMatchObject({ from: D_WED, days: 1, durationMinutes: 60 })
        expect(r.body.people).toEqual([{ personId: id.fay, kind: 'user', name: 'Fay Tech', source: 'shifts' }])
        expect(starts(r.body.slots, D_WED)).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'])
        expect(r.body.slots.every((s: any) => s.shift === 'regular' && s.endsAt === `${String(Number(s.startsAt.slice(0, 2)) + 1).padStart(2, '0')}${s.startsAt.slice(2)}`)).toBe(true)
        // a longer job has fewer places; a finer grid more
        expect(starts((await find({ from: D_WED, days: 1, duration: 240, personIds: id.fay })).body.slots, D_WED)).toEqual(['08:00', '13:00'])
        expect(starts((await find({ from: D_WED, days: 1, duration: 60, step: 15, personIds: id.fay })).body.slots, D_WED).length).toBe(26)
      })

      test('around booked jobs, with the drive between them', async () => {
        const booked = await job({ scheduledDate: D_WED, scheduledTime: '09:00', estimatedHours: 2, assignedToId: id.fay, address: '1 Main St' })
        expect(booked.status).toBe(201)
        await t.db.update(t.schema.job).set({ lat: 41.88, lng: -87.63 } as any).where(eq(t.schema.job.id, booked.body.id))
        // no place given: only the overlap is kept clear
        const plain = await find({ from: D_WED, days: 1, duration: 30, personIds: id.fay })
        expect(starts(plain.body.slots, D_WED).filter((s) => s < '12:00')).toEqual(['08:00', '08:30', '11:00', '11:30'])
        // 15 km east: about 19 minutes at 30 mph, so back-to-back with that job is out
        const far = await find({ from: D_WED, days: 1, duration: 30, personIds: id.fay, lat: 41.88, lng: -87.45 })
        expect(starts(far.body.slots, D_WED).filter((s) => s < '12:00')).toEqual(['08:00', '11:30'])
        const first = far.body.slots.find((s: any) => s.startsAt === '08:00'), later = far.body.slots.find((s: any) => s.startsAt === '11:30')
        expect(first.driveAfterMinutes).toBeGreaterThan(10); expect(first.driveBeforeMinutes).toBeNull()
        expect(later.driveBeforeMinutes).toBe(first.driveAfterMinutes); expect(later.driveAfterMinutes).toBeNull()
        // only an address, and a different one: a minute apart is the rule, so back-to-back is out but 08:30 is in
        const addressed = await find({ from: D_WED, days: 1, duration: 30, personIds: id.fay, address: '9 Other Rd' })
        expect(starts(addressed.body.slots, D_WED).filter((s) => s < '12:00')).toEqual(['08:00', '11:30'])
        // a helper's jobs count too
        const helped = await job({ scheduledDate: D_WED, scheduledTime: '14:00', estimatedHours: 1, assignedToId: id.manager, otherAssigneeIds: [id.fay] })
        expect(helped.status).toBe(201)
        expect(starts((await find({ from: D_WED, days: 1, duration: 60, personIds: id.fay })).body.slots, D_WED).filter((s) => s >= '13:00')).toEqual(['13:00', '15:00', '15:30', '16:00'])
      })

      test('never over time off; on-call slots come marked, after regular ones', async () => {
        expect((await as('owner', '/api/availability/time-off', 'POST', { personId: id.fay, from: D_FRI, to: D_FRI, startTime: '13:00', endTime: '15:00' })).status).toBe(201)
        expect(starts((await find({ from: D_FRI, days: 1, duration: 30, personIds: id.fay })).body.slots, D_FRI).filter((s) => s >= '13:00')).toEqual(['15:00', '15:30', '16:00', '16:30'])
        const whole = await as('owner', '/api/availability/time-off', 'POST', { personId: id.fay, from: '2026-12-10', to: '2026-12-10' })
        expect((await find({ from: '2026-12-10', days: 1, duration: 30, personIds: id.fay })).body.slots).toEqual([])
        await as('owner', `/api/availability/time-off/${whole.body.id}`, 'DELETE')
        const sat = await find({ from: D_SAT, days: 1, duration: 60, personIds: id.fay })
        expect(sat.body.slots.length).toBeGreaterThan(0)
        expect(sat.body.slots.every((s: any) => s.shift === 'on_call')).toBe(true)
      })

      test('anyone: everyone who can be given work, inside the business’s hours when they have no shifts, nobody with neither', async () => {
        await businessHours(null)
        const none = await find({ from: '2026-12-21', days: 1, duration: 60 })
        const who = (p: string) => none.body.people.find((x: any) => x.personId === p)
        expect(who(id.manager)).toMatchObject({ source: 'none' }); expect(who(id.viewer)).toBeUndefined()
        expect(who(id.rob)).toMatchObject({ kind: 'member', source: 'none' }); expect(who(id.fay)).toMatchObject({ source: 'shifts' })
        expect(none.body.slots.some((s: any) => s.personId === id.manager)).toBe(false)
        expect(none.body.slots.some((s: any) => s.personId === id.fay)).toBe(true)
        await businessHours({ monday: { open: '09:00', close: '15:00' }, tuesday: { open: '09:00', close: '15:00' }, wednesday: { open: '09:00', close: '15:00' }, thursday: { open: '09:00', close: '15:00' }, friday: { open: '09:00', close: '15:00' } })
        const some = await find({ from: '2026-12-21', days: 1, duration: 60, limit: 200 })
        expect(some.body.people.find((x: any) => x.personId === id.manager)).toMatchObject({ source: 'business_hours' })
        expect(starts(some.body.slots.filter((s: any) => s.personId === id.manager), '2026-12-21')).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00'])
        expect(some.body.slots.some((s: any) => s.personId === id.rob)).toBe(true)
        // earliest first; two people at the same moment keep the roster's order
        const dated = some.body.slots.map((s: any) => `${s.date} ${s.startsAt}`)
        expect([...dated].sort()).toEqual(dated)
        // the week ahead, capped
        const week = await find({ from: '2026-12-21', days: 7, duration: 60, personIds: id.fay, limit: 10 })
        expect(week.body.slots.length).toBe(10)
      })

      test('nothing before now on the company’s clock; the asks are validated', async () => {
        const nowChicago = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
        const yesterday = new Date(Date.parse(`${nowChicago}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
        const r = await find({ from: yesterday, days: 3, duration: 30 })
        expect(r.status).toBe(200)
        expect(r.body.slots.some((s: any) => s.date < nowChicago)).toBe(false)
        const hhmmNow = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
        expect(r.body.slots.filter((s: any) => s.date === nowChicago).every((s: any) => s.startsAt >= hhmmNow)).toBe(true)
        expect((await find({ from: D_WED })).status).toBe(400)
        expect((await find({ from: D_WED, duration: 60, days: 40 })).body.fields.days).toBeTruthy()
        expect((await find({ from: 'soon', duration: 60 })).status).toBe(400)
      })
    })

    describe('time off on the timesheet (ServiceTitan)', () => {
      const entries = async (who: string, from: string, to: string) => ((await as('owner', `/api/time?userId=${who}&startDate=${from}&endDate=${to}&limit=50`)).body.data as any[]).sort((a, b) => String(a.date).localeCompare(String(b.date)))

      test('one entry a day, the day’s regular hours; part of a day that long; no entry for a day with no shift', async () => {
        const r = await as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, from: '2026-11-23', to: '2026-11-25', note: 'Holiday', timesheet: true })
        expect(r.status).toBe(201); expect(r.body.timesheetEntries).toBe(3)
        const made = await entries(id.tia, '2026-11-23', '2026-11-25')
        expect(made.length).toBe(3)
        expect(made[0]).toMatchObject({ hours: '8.00', billable: false, approved: false, description: 'Time off — Holiday', timeOffId: r.body.id })
        expect(String(made[0].date).slice(0, 10)).toBe('2026-11-23')
        const part = await as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, from: '2026-11-26', to: '2026-11-26', startTime: '12:00', endTime: '14:00', timesheet: true })
        expect(part.body.timesheetEntries).toBe(1)
        expect((await entries(id.tia, '2026-11-26', '2026-11-26'))[0].hours).toBe('2.00')
        const weekend = await as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, from: '2026-11-27', to: '2026-11-28', timesheet: true })
        expect(weekend.body.timesheetEntries).toBe(1) // Friday, not Saturday
        // without asking: none
        const quiet = await as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, from: '2026-11-30', to: '2026-11-30' })
        expect(quiet.body.timesheetEntries).toBe(0)
        expect((await entries(id.tia, '2026-11-30', '2026-11-30')).length).toBe(0)
        const listed = (await as('manager', '/api/availability')).body.people.find((p: any) => p.personId === id.tia).timeOff
        expect(listed.find((o: any) => o.id === r.body.id).timesheet).toBe(true)
        expect(listed.find((o: any) => o.id === quiet.body.id).timesheet).toBe(false)
      })

      test('a person with no shifts gets the business’s hours; roster-only crew have no timesheet', async () => {
        await businessHours({ monday: { open: '09:00', close: '15:00' }, tuesday: { open: '09:00', close: '15:00' } })
        const r = await as('owner', '/api/availability/time-off', 'POST', { personId: id.manager, from: '2026-11-23', to: '2026-11-24', timesheet: true })
        expect(r.body.timesheetEntries).toBe(2)
        expect((await entries(id.manager, '2026-11-23', '2026-11-24')).map((e) => e.hours)).toEqual(['6.00', '6.00'])
        const rob = await as('owner', '/api/availability/time-off', 'POST', { personId: id.rob, from: '2026-11-23', to: '2026-11-23', timesheet: true })
        expect(rob.status).toBe(400); expect(rob.body.fields.timesheet).toBeTruthy()
      })

      test('removing the time off removes its entries — an approved one stays, unlinked', async () => {
        const r = await as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, from: '2026-12-21', to: '2026-12-23', timesheet: true })
        const made = await entries(id.tia, '2026-12-21', '2026-12-23')
        expect(made.length).toBe(3)
        expect((await as('owner', `/api/time/${made[0].id}/approve`, 'POST')).status).toBe(200)
        expect((await as('owner', `/api/availability/time-off/${r.body.id}`, 'DELETE')).status).toBe(200)
        const left = await entries(id.tia, '2026-12-21', '2026-12-23')
        expect(left.length).toBe(1)
        expect(left[0]).toMatchObject({ id: made[0].id, approved: true, timeOffId: null })
      })
    })

    describe('a repeating series is checked visit by visit', () => {
      const series = (fields: Record<string, unknown>) => job({ scheduledDate: '2026-12-01', scheduledTime: '09:00', assignedToId: id.tia, repeat: { frequency: 'weekly', interval: 1, count: 3 }, ...fields })

      test('a visit on a day off is listed back, not made; booked anyway, it is made and recorded', async () => {
        const off = await as('owner', '/api/availability/time-off', 'POST', { personId: id.tia, from: '2026-12-08', to: '2026-12-08', note: 'Jury' })
        expect(off.status).toBe(201)
        const r = await series({})
        expect(r.status).toBe(201)
        expect(r.body.series).toMatchObject({ made: 2, skipped: [{ date: '2026-12-08', code: 'unavailable' }] })
        expect(r.body.series.skipped[0].reason).toBe('Tia Tech is off on Dec 8 (Jury).')
        // the same series again, at another time (the first one's visits are already in the diary), booked past the day off
        const forced = await series({ scheduledTime: '10:30', bookAnyway: true })
        expect(forced.status).toBe(201)
        expect(forced.body.series).toMatchObject({ made: 3, skipped: [] })
        const rows = await t.db.select().from(t.schema.auditLog).where(and(eq(t.schema.auditLog.companyId, co), eq(t.schema.auditLog.action, 'book_anyway')))
        expect(rows.some((x: any) => x.entityId === forced.body.id && JSON.stringify(x.metadata).includes('time_off'))).toBe(true)
      })

      test('every visit on a day the person does not work: nothing made, the office is asked', async () => {
        const r = await series({ scheduledDate: '2026-12-05' }) // Saturdays
        expect(r.status).toBe(409)
        expect(r.body).toMatchObject({ code: 'unavailable', canBookAnyway: true })
        expect(r.body.error).toContain('None of the visits could be booked: Tia Tech does not work Saturdays.')
      })
    })
  })
}
