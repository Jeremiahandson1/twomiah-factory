// Home care's scheduling group (server/crm/homecare/scheduling) through the real server, as the homecare vertical: the
// mounts answer, the office's side is refused to a caregiver and reached by the office, the replies are the rulebook's
// (camelCase rows, lists as { data, pagination }), every read and write is the signed-in person's company's, and the
// template defects fixed in the move stay fixed:
//   · GET /schedules-all, /schedules-enhanced, /scheduling/schedules, /scheduling/caregiver-schedules and
//     /scheduling/absences answered every caregiver's rows to any signed-in person: a caregiver now gets their own;
//     GET /scheduling/open-shifts answered every posting: a caregiver now gets the ones offered to them;
//   · POST / PUT /scheduling/schedules took the body whole (a body's companyId was written);
//   · /matching/client/:id/needs (medical conditions, allergies), /schedule-prefs and /restrictions answered any client
//     to any signed-in person: a caregiver now reads them only for a client they care for.
// The template suite's own file (tests/homecare/scheduling.test.ts) runs as an adapted copy (tests/unified/homecare/).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  const mk = async (email: string, first: string) => (await t.db.insert(t.schema.user).values({
    email, passwordHash: hash, firstName: first, lastName: 'Carer', role: 'caregiver', companyId,
  } as any).returning())[0]
  ids.ann = (await mk('ann@test.example', 'Ann')).id
  ids.bob = (await mk('bob@test.example', 'Bob')).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  tokens.bob = await login('bob@test.example', 'Caregiver-pass-1')
  const [pat] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true, allergies: 'penicillin' } as any).returning()
  const [sam] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Sam', lastName: 'Client', isActive: true, isPrivatePay: true } as any).returning()
  ids.pat = pat.id
  ids.sam = sam.id
  // Another company in the same database, with a client and a schedule of its own.
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Care', slug: 'other-care' }).returning()
  ids.otherCo = other.id
  const [stranger] = await t.db.insert(t.schema.clients).values({ companyId: other.id, firstName: 'Zed', lastName: 'Elsewhere' } as any).returning()
  ids.stranger = stranger.id
  const [os] = await t.db.insert(t.schema.schedules).values({
    companyId: other.id, clientId: stranger.id, caregiverId: ids.ann, dayOfWeek: null, date: '2026-12-01', scheduleType: 'one-time',
    startTime: new Date('2026-12-01T09:00:00Z'), endTime: new Date('2026-12-01T11:00:00Z'),
  } as any).returning()
  ids.otherSchedule = os.id
}, 60_000)

describe('home care — scheduling', () => {
  test('the office side is the office\'s; a caregiver reaches their own', async () => {
    const office = [
      '/api/schedule-exceptions', '/api/open-shifts', '/api/absences', '/api/no-show/alerts', '/api/no-show/stats', '/api/no-show/config',
      '/api/scheduling/coverage-overview', '/api/scheduling/conflict-heatmap', '/api/scheduling/noshow-alerts', '/api/scheduling/noshow-config',
      `/api/scheduling/suggest-caregivers?clientId=${ids.pat}`, '/api/forecast/revenue', '/api/forecast/caregiver-utilization',
      '/api/open-shifts/caregivers-available?date=2026-11-02&startTime=09:00&endTime=10:00',
    ]
    for (const p of office) {
      expect({ p, status: (await as('ann')(p)).status }).toEqual({ p, status: 403 })
      expect({ p, status: (await as('owner')(p)).status }).toEqual({ p, status: 200 })
    }
    const mine = [
      `/api/schedules/${ids.ann}`, `/api/schedules/caregiver/${ids.ann}`, `/api/schedules/${ids.ann}/occurrences`, '/api/schedules-all',
      '/api/scheduling/week-view', `/api/scheduling/caregiver-hours/${ids.ann}`, '/api/open-shifts/available', '/api/shift-swaps',
      '/api/absences/my', '/api/blackout-dates', '/api/scheduling/time-off', '/api/matching/capabilities',
    ]
    for (const p of mine) expect({ p, status: (await as('ann')(p)).status }).toEqual({ p, status: 200 })
    for (const p of [`/api/schedules/${ids.bob}`, `/api/scheduling/caregiver-hours/${ids.bob}`, `/api/caregiver-availability/${ids.bob}`]) {
      expect({ p, status: (await as('ann')(p)).status }).toEqual({ p, status: 403 })
    }
    // Writes a caregiver holds no permission for.
    expect((await as('ann')('/api/schedules', { method: 'POST', json: { caregiverId: ids.ann, clientId: ids.pat, date: '2026-12-02', startTime: '09:00', endTime: '10:00' } })).status).toBe(403)
    expect((await as('ann')('/api/scheduling/bulk-create', { method: 'POST', json: {} })).status).toBe(403)
    expect((await as('ann')(`/api/matching/client/${ids.pat}/needs`, { method: 'PUT', json: { allergies: 'none' } })).status).toBe(403)
  }, 60_000)

  test('a shift: created in camelCase, listed as a list reply, its exceptions attached', async () => {
    const made = await json(await as('owner')('/api/schedules', { method: 'POST', json: { caregiverId: ids.ann, clientId: ids.pat, scheduleType: 'one-time', date: '2026-12-02', startTime: '09:00', endTime: '11:00' } }))
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ caregiverId: ids.ann, clientId: ids.pat, date: '2026-12-02', startTime: '09:00:00', endTime: '11:00:00', authWarnings: [] })
    expect('caregiver_id' in made.body).toBe(false)
    ids.annShift = made.body.id
    const [row] = await t.db.select().from(t.schema.schedules).where(eq(t.schema.schedules.id, ids.annShift))
    expect(row.companyId).toBe(companyId)
    const twin = await json(await as('owner')('/api/schedules', { method: 'POST', json: { caregiverId: ids.ann, clientId: ids.pat, scheduleType: 'one-time', date: '2026-12-02', startTime: '09:00', endTime: '11:00' } }))
    expect(twin.status).toBe(200)
    expect(twin.body).toMatchObject({ id: ids.annShift, duplicate: true })
    const listed = await json(await as('ann')(`/api/schedules/caregiver/${ids.ann}`))
    expect(listed.body.pagination.total).toBe(1)
    expect(listed.body.data[0]).toMatchObject({ id: ids.annShift, clientFirstName: 'Pat', exceptions: [] })
    const bobs = await json(await as('owner')('/api/schedules-enhanced', { method: 'POST', json: { caregiverId: ids.bob, clientId: ids.sam, scheduleType: 'one-time', date: '2026-12-03', startTime: '13:00', endTime: '15:00' } }))
    expect(bobs.status).toBe(201)
    ids.bobShift = bobs.body.id
  })

  test('another company\'s schedule is not this company\'s', async () => {
    expect((await as('owner')(`/api/schedules/${ids.otherSchedule}?scope=all`, { method: 'DELETE' })).status).toBe(404)
    expect((await as('owner')(`/api/schedules/${ids.otherSchedule}/reassign`, { method: 'PUT', json: { newCaregiverId: ids.bob } })).status).toBe(404)
    expect((await as('owner')(`/api/schedules-all/${ids.otherSchedule}`, { method: 'PUT', json: { notes: 'x' } })).status).toBe(404)
    const all = await json(await as('owner')('/api/schedules-all'))
    expect(all.body.data.map((s: any) => s.id)).not.toContain(ids.otherSchedule)
    const [still] = await t.db.select().from(t.schema.schedules).where(eq(t.schema.schedules.id, ids.otherSchedule))
    expect(still.isActive).toBe(true)
  })

  test('the office lists see everyone; a caregiver\'s answer holds only their own shifts (fixed in the move)', async () => {
    for (const p of ['/api/schedules-all', '/api/schedules-enhanced', '/api/scheduling/schedules']) {
      const office = await json(await as('owner')(p))
      expect({ p, ids: office.body.data.map((s: any) => s.id).sort() }).toEqual({ p, ids: [ids.annShift, ids.bobShift].sort() })
      const ann = await json(await as('ann')(p))
      expect({ p, ids: ann.body.data.map((s: any) => s.id) }).toEqual({ p, ids: [ids.annShift] })
      // A caregiver naming someone else still gets their own.
      const named = await json(await as('ann')(`${p}?caregiverId=${ids.bob}`))
      expect({ p, ids: named.body.data.map((s: any) => s.id) }).toEqual({ p, ids: [ids.annShift] })
    }
  })

  test('absences, the availability calendar and open shifts: a caregiver reads their own (fixed in the move)', async () => {
    await t.db.insert(t.schema.absences).values([
      { companyId, caregiverId: ids.ann, date: '2026-11-10', type: 'sick', reason: 'flu' },
      { companyId, caregiverId: ids.bob, date: '2026-11-11', type: 'personal', reason: 'family' },
    ] as any)
    await t.db.insert(t.schema.caregiverSchedules).values([
      { companyId, caregiverId: ids.ann, date: '2026-11-10', isAvailable: true },
      { companyId, caregiverId: ids.bob, date: '2026-11-10', isAvailable: false },
    ] as any)
    for (const p of ['/api/scheduling/absences', '/api/scheduling/caregiver-schedules']) {
      expect({ p, n: (await json(await as('owner')(p))).body.data.length }).toEqual({ p, n: 2 })
      const ann = (await json(await as('ann')(p))).body.data
      expect({ p, who: [...new Set(ann.map((r: any) => r.caregiverId))] }).toEqual({ p, who: [ids.ann] })
    }
    // Absences are the office's list on /api/absences; the caregiver's own is /my.
    expect((await json(await as('ann')('/api/absences/my'))).body.data.map((r: any) => r.reason)).toEqual(['flu'])

    await t.db.insert(t.schema.openShifts).values([
      { companyId, clientId: ids.pat, date: '2026-12-10', startTime: '09:00:00', endTime: '11:00:00', status: 'open', notes: 'everyone' },
      { companyId, clientId: ids.pat, date: '2026-12-11', startTime: '09:00:00', endTime: '11:00:00', status: 'open', notes: 'bob only', visibleTo: [ids.bob] },
    ] as any)
    const office = (await json(await as('owner')('/api/scheduling/open-shifts'))).body.data.map((s: any) => s.notes).sort()
    expect(office).toEqual(['bob only', 'everyone'])
    expect((await json(await as('ann')('/api/scheduling/open-shifts'))).body.data.map((s: any) => s.notes)).toEqual(['everyone'])
    expect((await json(await as('bob')('/api/scheduling/open-shifts'))).body.data.map((s: any) => s.notes).sort()).toEqual(['bob only', 'everyone'])
  })

  test('POST / PUT /scheduling/schedules never write a body\'s company or id (fixed in the move)', async () => {
    const made = await json(await as('owner')('/api/scheduling/schedules', { method: 'POST', json: {
      companyId: ids.otherCo, id: 'forged', clientId: ids.pat, caregiverId: ids.bob, dayOfWeek: 3, effectiveDate: '2026-12-01',
    } }))
    expect(made.status).toBe(201)
    expect(made.body.companyId).toBe(companyId)
    expect(made.body.id).not.toBe('forged')
    const moved = await json(await as('owner')(`/api/scheduling/schedules/${made.body.id}`, { method: 'PUT', json: { companyId: ids.otherCo, notes: 'kept' } }))
    expect(moved.status).toBe(200)
    expect(moved.body).toMatchObject({ companyId, notes: 'kept' })
    expect((await as('owner')(`/api/scheduling/schedules/${ids.otherSchedule}`, { method: 'PUT', json: { notes: 'x' } })).status).toBe(404)
    await as('owner')(`/api/scheduling/schedules/${made.body.id}`, { method: 'DELETE' })
  })

  test('a client\'s needs, preferences and restrictions: a caregiver only for a client they care for (fixed in the move)', async () => {
    for (const p of ['needs', 'schedule-prefs', 'restrictions']) {
      // Ann has a shift with Pat, none with Sam.
      expect({ p, status: (await as('ann')(`/api/matching/client/${ids.pat}/${p}`)).status }).toEqual({ p, status: 200 })
      expect({ p, status: (await as('ann')(`/api/matching/client/${ids.sam}/${p}`)).status }).toEqual({ p, status: 403 })
      expect({ p, status: (await as('owner')(`/api/matching/client/${ids.sam}/${p}`)).status }).toEqual({ p, status: 200 })
      // Another company's client is not the office's either.
      expect({ p, status: (await as('owner')(`/api/matching/client/${ids.stranger}/${p}`)).status }).toEqual({ p, status: 403 })
    }
    expect((await json(await as('ann')(`/api/matching/client/${ids.pat}/needs`))).body).toMatchObject({ id: ids.pat, allergies: 'penicillin' })
  })

  test('an open shift: posted from a schedule, accepted by the caregiver, approved by the office', async () => {
    const posted = await json(await as('owner')(`/api/open-shifts/from-schedule/${ids.bobShift}`, { method: 'POST', json: { date: '2026-12-03', visibleTo: [ids.ann] } }))
    expect(posted.status).toBe(200)
    expect(posted.body).toMatchObject({ shiftDate: '2026-12-03', startTime: '13:00:00', endTime: '15:00:00', status: 'open', visibleTo: [ids.ann] })
    const again = await json(await as('owner')(`/api/open-shifts/from-schedule/${ids.bobShift}`, { method: 'POST', json: { date: '2026-12-03' } }))
    expect(again).toMatchObject({ status: 409, body: { code: 'already_posted' } })
    expect((await as('bob')(`/api/open-shifts/${posted.body.id}/claim`, { method: 'POST', json: {} })).status).toBe(403)
    const claim = await json(await as('ann')(`/api/open-shifts/${posted.body.id}/claim`, { method: 'POST', json: {} }))
    expect(claim).toMatchObject({ status: 200, body: { success: true, assigned: false } })
    const ok = await json(await as('owner')(`/api/open-shifts/${posted.body.id}/approve`, { method: 'POST', json: {} }))
    expect(ok).toMatchObject({ status: 200, body: { success: true } })
    const [s] = await t.db.select().from(t.schema.schedules).where(eq(t.schema.schedules.id, ids.bobShift))
    expect(s.caregiverId).toBe(ids.ann)
    const [claimRow] = await t.db.select().from(t.schema.openShiftClaims).where(eq(t.schema.openShiftClaims.openShiftId, posted.body.id))
    expect(claimRow).toMatchObject({ companyId, status: 'approved' })
  })

  test('a self-service write: a caregiver files only their own', async () => {
    expect((await as('ann')('/api/absences', { method: 'POST', json: { caregiverId: ids.bob, date: '2026-12-20', type: 'sick' } })).status).toBe(403)
    const own = await json(await as('ann')('/api/absences', { method: 'POST', json: { date: '2026-12-20', type: 'sick', coverageNeeded: false } }))
    expect(own.status).toBe(201)
    expect(own.body).toMatchObject({ caregiverId: ids.ann, companyId, coverageNeeded: true })
    const off = await json(await as('ann')('/api/scheduling/time-off', { method: 'POST', json: { startDate: '2026-12-24', endDate: '2026-12-26', type: 'vacation', status: 'approved' } }))
    expect(off.body).toMatchObject({ caregiverId: ids.ann, status: 'pending', companyId })
    const bl = await json(await as('ann')('/api/blackout-dates', { method: 'POST', json: { startDate: '2026-12-31', endDate: '2026-12-31' } }))
    expect((await as('bob')(`/api/blackout-dates/${bl.body.id}`, { method: 'DELETE' })).status).toBe(403)
    const avail = await json(await as('ann')(`/api/caregiver-availability/${ids.ann}`, { method: 'PUT', json: { maxHoursPerWeek: 30, companyId: ids.otherCo } }))
    expect(avail.status).toBe(201)
    expect(avail.body).toMatchObject({ caregiverId: ids.ann, companyId, maxHoursPerWeek: 30 })
  })

  test('the Schedule Hub and shift swaps run on the engine, in camelCase', async () => {
    const week = await json(await as('owner')('/api/scheduling/week-view?weekOf=2026-12-02'))
    const annWeek = week.body.caregivers.find((x: any) => x.caregiver.id === ids.ann)
    expect(annWeek.caregiver).toMatchObject({ firstName: 'Ann', lastName: 'Carer' })
    expect(annWeek.days[3].map((o: any) => o.id)).toEqual([ids.annShift])
    expect(annWeek.days[4].map((o: any) => o.id)).toEqual([ids.bobShift]) // Bob's Thursday, approved onto Ann above
    expect((await json(await as('ann')('/api/scheduling/week-view?weekOf=2026-12-02'))).body.caregivers.map((x: any) => x.caregiver.id)).toEqual([ids.ann])
    const heat = await json(await as('owner')('/api/scheduling/conflict-heatmap?weekOf=2026-12-02'))
    expect(heat.body.caregivers.find((x: any) => x.id === ids.ann)).toMatchObject({ firstName: 'Ann', maxHoursPerWeek: 30, total: 4 })
    const conflicts = await json(await as('owner')('/api/scheduling/check-conflicts', { method: 'POST', json: { caregiverId: ids.ann, date: '2026-12-02', startTime: '10:00', endTime: '12:00' } }))
    expect(conflicts.body).toMatchObject({ hasConflict: true, conflicts: [{ id: ids.annShift, clientName: 'Pat Client' }] })
    const hours = await json(await as('owner')('/api/scheduling/check-weekly-hours', { method: 'POST', json: { caregiverId: ids.ann, date: '2026-12-02', startTime: '09:00', endTime: '17:00' } }))
    expect(hours.body).toMatchObject({ currentWeeklyHours: 4, proposedHours: 8, maxHours: 30, caregiverName: 'Ann Carer' })
    const travel = await json(await as('owner')('/api/scheduling/check-travel-time', { method: 'POST', json: { caregiverId: ids.ann, clientId: ids.pat, date: '2026-12-02', startTime: '09:00', endTime: '10:00' } }))
    expect(travel.body.note).toBe('Client has no GPS coordinates set')
    const sugg = await json(await as('owner')(`/api/scheduling/suggest-caregivers?clientId=${ids.sam}&date=2026-12-03&startTime=13:00&endTime=15:00`))
    const s = sugg.body.suggestions.find((x: any) => x.id === ids.ann)
    expect(s).toMatchObject({ firstName: 'Ann', hasConflict: true, isBlackedOut: false })
    expect(sugg.body.client).toMatchObject({ id: ids.sam, firstName: 'Sam' })
    const bulk = await json(await as('owner')('/api/scheduling/bulk-create', { method: 'POST', json: { caregiverId: ids.bob, clientId: ids.sam, startDate: '2027-01-04', weeks: 2, template: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }] } }))
    expect(bulk.body).toMatchObject({ success: true, created: 2, skippedConflicts: 0 })
    const fill = await json(await as('owner')('/api/scheduling/auto-fill', { method: 'POST', json: { startDate: '2026-12-09', endDate: '2026-12-12', dryRun: true } }))
    expect(fill.body).toMatchObject({ success: true, dryRun: true, total: 2 })

    // A swap: Ann asks Bob to take her Dec 2 visit; Bob accepts; the office approves.
    expect((await as('bob')('/api/shift-swaps', { method: 'POST', json: { scheduleId: ids.annShift, targetCaregiverId: ids.bob } })).status).toBe(403)
    const asked = await json(await as('ann')('/api/shift-swaps', { method: 'POST', json: { scheduleId: ids.annShift, targetCaregiverId: ids.bob, reason: 'appointment' } }))
    expect(asked.status).toBe(201)
    expect(asked.body).toMatchObject({ requesterId: ids.ann, targetId: ids.bob, shiftDate: '2026-12-02', startTime: '09:00:00', status: 'pending' })
    expect((await json(await as('ann')('/api/shift-swaps', { method: 'POST', json: { scheduleId: ids.annShift, targetCaregiverId: ids.bob } }))).body.code).toBe('swap_pending')
    expect((await as('ann')(`/api/shift-swaps/${asked.body.id}/respond`, { method: 'PUT', json: { accepted: true } })).status).toBe(403)
    expect((await as('bob')(`/api/shift-swaps/${asked.body.id}/respond`, { method: 'PUT', json: { accepted: true } })).status).toBe(200)
    expect((await as('bob')(`/api/shift-swaps/${asked.body.id}/approve`, { method: 'PUT' })).status).toBe(403)
    expect((await as('owner')(`/api/shift-swaps/${asked.body.id}/approve`, { method: 'PUT' })).status).toBe(200)
    const [moved] = await t.db.select().from(t.schema.schedules).where(eq(t.schema.schedules.id, ids.annShift))
    expect(moved.caregiverId).toBe(ids.bob)
    const bobsSwaps = await json(await as('bob')('/api/shift-swaps'))
    expect(bobsSwaps.body.data.map((x: any) => [x.id, x.status, x.requesterFirstName])).toEqual([[asked.body.id, 'approved', 'Ann']])
  })

  test('the forecast reads the company\'s authorizations and schedule', async () => {
    await t.db.insert(t.schema.authorizations).values({
      companyId, clientId: ids.sam, authNumber: 'A-1', authorizedUnits: '40', usedUnits: '0', unitType: '15min', status: 'active',
      startDate: '2026-01-01', endDate: '2027-12-31',
    } as any)
    const f = await json(await as('owner')('/api/forecast/revenue'))
    expect(f.status).toBe(200)
    expect(f.body.projected.find((r: any) => r.clientId === ids.sam)).toMatchObject({ clientName: 'Sam Client', authorizedHours: '10.0000000000000000' })
    expect(f.body.authSummary).toMatchObject({ totalActiveAuths: 1, totalAuthHours: 10 })
    const u = await json(await as('owner')('/api/forecast/caregiver-utilization'))
    expect(u.body.data.map((r: any) => r.caregiverName).sort()).toEqual(['Ann Carer', 'Bob Carer'])
  })

  test('the no-show stats are camelCase and the company\'s', async () => {
    await t.db.insert(t.schema.noshowAlerts).values([
      { companyId, shiftDate: '2026-10-01', expectedStart: '09:00:00', status: 'open' },
      { companyId: ids.otherCo, shiftDate: '2026-10-01', expectedStart: '09:00:00', status: 'open' },
    ] as any)
    const s = await json(await as('owner')('/api/no-show/stats'))
    expect(s.body).toMatchObject({ total: 1, openCount: 1, pending: 1, resolved: 0 })
  })
})
