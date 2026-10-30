// PR #172 follow-up 10/30 — the owner's seven fixes, each proved on the real server.
//   1. auto-fill never offers or assigns a caregiver on the client's do-not-use list, on time off, or outside their availability
//   (more sections are added below, one describe per fix)
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  tokens.owner = await login('owner@test.example', seeded.password)
}, 90_000)

const hash = () => Bun.password.hash('Caregiver-pass-1', 'bcrypt')
const caregiver = async (key: string, extra: any = {}) => {
  const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await hash(), firstName: key[0].toUpperCase() + key.slice(1), lastName: 'Carer', role: 'caregiver', companyId, ...extra })
  ids[key] = u.id
  return u.id as string
}

// ── 1. auto-fill ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2026-12-09 is a Wednesday. The shift is 09:00–11:00.
const SHIFT_DAY = '2026-12-09'
describe('follow-up 1 — auto-fill keeps to do-not-use, time off and availability', () => {
  const all = ['dnu', 'off', 'closed', 'late', 'away', 'good']
  let shiftN = 0
  const openShift = async () => (await ins(t.schema.openShifts, { companyId, clientId: ids.pat, date: SHIFT_DAY, startTime: '09:00:00', endTime: '11:00:00', status: 'open', urgency: 'high' })).id as string
  /** Only `who` are active caregivers for this run, so what auto-fill does with each is not hidden by someone better. */
  const onlyActive = async (who: string[]) => {
    for (const k of all) await t.db.update(t.schema.user).set({ isActive: who.includes(k) }).where(eq(t.schema.user.id, ids[k]))
  }
  const fill = async (dryRun: boolean) => (await json(await as('owner')('/api/scheduling/auto-fill', { method: 'POST', json: { startDate: SHIFT_DAY, endDate: SHIFT_DAY, dryRun } }))).body

  beforeAll(async () => {
    for (const k of all) await caregiver(k)
    ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
    await t.db.update(t.schema.clients).set({ doNotUseCaregivers: [ids.dnu] } as any).where(eq(t.schema.clients.id, ids.pat))
    // On approved time off that Wednesday.
    await ins(t.schema.caregiverTimeOff, { companyId, caregiverId: ids.off, startDate: '2026-12-08', endDate: '2026-12-10', type: 'vacation', status: 'approved' })
    // Marked unavailable.
    await ins(t.schema.caregiverAvailability, { companyId, caregiverId: ids.closed, status: 'unavailable' })
    // Works Wednesdays, but only 13:00–17:00 — the shift is 09:00–11:00.
    await ins(t.schema.caregiverAvailability, { companyId, caregiverId: ids.late, status: 'available', wednesdayAvailable: true, wednesdayStartTime: '13:00:00', wednesdayEndTime: '17:00:00' })
    // Does not work Wednesdays at all.
    await ins(t.schema.caregiverAvailability, { companyId, caregiverId: ids.away, status: 'available', wednesdayAvailable: false })
  }, 60_000)

  for (const [key, why] of [['dnu', 'on the client\'s do-not-use list'], ['off', 'on approved time off'], ['late', 'outside the hours they gave for that day'], ['away', 'not working that weekday'], ['closed', 'marked unavailable']] as const) {
    test(`a caregiver ${why} is not offered and not assigned`, async () => {
      await onlyActive([key])
      const id = await openShift()
      const preview = await fill(true)
      const mine = preview.results.find((r: any) => r.shiftId === id)
      expect(mine.status).toBe('unfilled')
      expect(mine.caregiverId).toBeUndefined()
      const real = await fill(false)
      expect(real.filled).toBe(0)
      const row = ((await t.db.select().from(t.schema.openShifts).where(eq(t.schema.openShifts.id, id))) as any[])[0]
      expect(row.status).toBe('open')
      expect(row.claimedById ?? null).toBeNull()
      await t.db.update(t.schema.openShifts).set({ status: 'cancelled' }).where(eq(t.schema.openShifts.id, id))
      shiftN++
    })
  }

  test('with everyone active, the shift goes to the one caregiver who may take it', async () => {
    await onlyActive(all)
    const id = await openShift()
    const real = await fill(false)
    const mine = real.results.find((r: any) => r.shiftId === id)
    expect(mine.status).toBe('filled')
    expect(mine.caregiverId).toBe(ids.good)
  })

  test('the suggestion list reads the same rule: do-not-use and time off are left out, the rest are shown with the reason', async () => {
    await onlyActive(all)
    const q = `/api/scheduling/suggest-caregivers?clientId=${ids.pat}&date=${SHIFT_DAY}&startTime=09:00&endTime=11:00`
    const shown = (await json(await as('owner')(q))).body.suggestions.map((s: any) => s.id)
    expect(shown).not.toContain(ids.dnu)
    expect(shown).not.toContain(ids.off)
    expect(shown).toContain(ids.good)
    const everyone = (await json(await as('owner')(`${q}&includeBlocked=true`))).body.suggestions
    const by = (k: string) => everyone.find((s: any) => s.id === ids[k])
    expect(by('dnu').isDnu).toBe(true)
    expect(by('off').isBlackedOut).toBe(true)
    expect(by('closed').isAvailable).toBe(false)
    expect(by('late').reasons.join(' ')).toContain('Outside availability window')
  })
})

// ── 2. the visit list cuts days on the agency's clock ────────────────────────────────────────────────────────────
// (The profile-schedule test in homecare-hr.test.ts that failed with start times six hours late was a test-data fault: it built the
// stored wall-clock times with `new Date('…T09:00:00')`, which is the machine's own zone, while the app stores a schedule's clock time as
// written, in UTC form. It passes on a UTC machine only; the test now writes them the way the app does. This section is the real
// agency-zone fault found while looking: the office visit list cut its start and end dates at UTC midnight / the server's 23:59:59.)
describe('follow-up 2 — the office visit list uses the agency\'s own day', () => {
  test('a visit at 8 PM Central on the end date is in that day; one at 7 PM the evening before the start date is not', async () => {
    await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
    t.services.features?.forgetFeatures?.()
    const cg = await caregiver('tz')
    const cl = (await ins(t.schema.clients, { companyId, firstName: 'Tess', lastName: 'Zone', isActive: true })).id
    const visit = (iso: string, mins: number) => ins(t.schema.timeEntries, { companyId, caregiverId: cg, clientId: cl, startTime: new Date(iso), endTime: new Date(new Date(iso).getTime() + mins * 60000), durationMinutes: mins, isComplete: true })
    const evening = await visit('2026-12-10T02:00:00Z', 60) // 8 PM on Dec 9 in Chicago (UTC-6)
    const before = await visit('2026-12-09T01:00:00Z', 60) // 7 PM on Dec 8 in Chicago
    const r = await json(await as('owner')(`/api/time-tracking?caregiverId=${cg}&startDate=2026-12-09&endDate=2026-12-09`))
    expect(r.status).toBe(200)
    expect(r.body.data.map((e: any) => e.id)).toEqual([evening.id])
    expect(r.body.data.map((e: any) => e.id)).not.toContain(before.id)
  })
})

// ── 4. a clock-out by phone with required tasks not done ─────────────────────────────────────────────────────────
describe('follow-up 4 — a phone-call clock-out is recorded and flagged, not blocked', () => {
  const twilio = (path: string, form: Record<string, string>) =>
    t.call(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() })
  const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
  const open = async (client: string) => (await ins(t.schema.timeEntries, { companyId, caregiverId: ids.ivr, clientId: client, startTime: new Date(Date.now() - 2 * 3_600_000), isComplete: false })).id as string
  const entry = async (id: string) => ((await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, id))) as any[])[0]

  test('with a required task open, the call ends the visit and the office sees why; with none open nothing is flagged; without the feature nothing changes', async () => {
    ids.ivr = await caregiver('ivr', { ivrPin: '4321' })
    const client = (await ins(t.schema.clients, { companyId, firstName: 'Ina', lastName: 'Phone', isActive: true, isPrivatePay: true })).id
    await setFeatures(['contacts', 'scheduling', 'team'])
    const plain = await open(client)
    await twilio(`/api/ivr/clock-out?caregiverId=${ids.ivr}&timeEntryId=${plain}`, { Digits: '1', From: '+17155550101' })
    expect((await entry(plain)).approvalReason).toBeNull() // feature off: no flag

    await setFeatures(['contacts', 'scheduling', 'team', 'care_required_tasks'])
    const made = await json(await as('owner')(`/api/care-tasks/client/${client}`, { method: 'POST', json: { taskName: 'Lock the back door', category: 'safety', isRequired: true } }))
    expect(made.status).toBe(200)
    const e = await open(client)
    const said = await (await twilio(`/api/ivr/clock-out?caregiverId=${ids.ivr}&timeEntryId=${e}`, { Digits: '1', From: '+17155550101' })).text()
    expect(said).toContain('You are now clocked out') // not blocked
    const row = await entry(e)
    expect(row.isComplete).toBe(true)
    expect(row.endTime).not.toBeNull()
    expect(row.needsApproval).toBe(true)
    expect(row.approvalReason).toContain('Clocked out by phone with required tasks not done: Lock the back door')
    // ...and it is on the list where the office reviews visits.
    const review = (await json(await as('owner')('/api/time-entries/pending-approval'))).body.data
    expect(review.find((r: any) => r.id === e)?.approvalReason).toContain('required tasks not done')

    // The task done first: nothing to flag.
    await ins(t.schema.clientAssignments, { companyId, clientId: client, caregiverId: ids.ivr, assignmentDate: '2026-10-01', status: 'active' })
    tokens.ivr = await login('ivr@test.example', 'Caregiver-pass-1')
    const e2 = await open(client)
    const done = await as('ivr')(`/api/care-tasks/time-entry/${e2}/${made.body.id}`, { method: 'PUT', json: { status: 'completed' } })
    expect(done.status).toBe(200)
    await twilio(`/api/ivr/clock-out?caregiverId=${ids.ivr}&timeEntryId=${e2}`, { Digits: '1', From: '+17155550101' })
    expect((await entry(e2)).approvalReason ?? '').not.toContain('required tasks')
  })
})
