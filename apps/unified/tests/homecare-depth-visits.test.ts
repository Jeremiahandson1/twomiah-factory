// Home care depth, item 12 (docs/parity/homecare-required-tasks-repeats.md):
//   · a client's task can be REQUIRED: the caregiver cannot clock out until it is done, or skipped / refused with a reason;
//   · a shift can repeat MONTHLY (the 2nd Tuesday) or every 3 to 12 weeks, and every place that expands a schedule (payroll,
//     billing, the calendar, the phone) sees the same days because they all use the one occurrence engine.
// Both are off (and refused) for an agency without care_required_tasks / care_shift_repeats.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
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
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BASE = ['contacts', 'scheduling', 'team']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  await ins(t.schema.clientAssignments, { companyId, clientId: ids.pat, caregiverId: ids.ann, assignmentDate: '2026-10-01', status: 'active' })
  await setFeatures(BASE)
}, 90_000)

// ── shifts that repeat ───────────────────────────────────────────────────────────────────────
const create = async (extra: any) => json(await as('owner')('/api/schedules-enhanced', { method: 'POST', json: { caregiverId: ids.ann, clientId: ids.pat, startTime: '09:00', endTime: '11:00', ...extra } }))
const days = async (from: string, to: string) =>
  ((await json(await as('owner')(`/api/schedules/${ids.ann}/occurrences?from=${from}&to=${to}`))).body.occurrences as any[]).map((o) => String(o.date ?? o.occDate).slice(0, 10)).sort()
const remove = async (id: string) => t.db.update(t.schema.schedules).set({ isActive: false } as any).where(eq(t.schema.schedules.id, id))

describe('home care — monthly and every-N-weeks shifts (item 12)', () => {
  test('without the feature they are refused, and weekly / every-other-week still work', async () => {
    const monthly = await create({ dayOfWeek: 2, frequency: 'monthly', effectiveDate: '2026-12-08' })
    expect(monthly.status).toBe(400)
    expect(monthly.body.code).toBe('repeat_not_available')
    const three = await create({ dayOfWeek: 2, repeatEveryWeeks: 3, effectiveDate: '2026-12-01' })
    expect(three.body.code).toBe('repeat_not_available')
    const biweekly = await create({ dayOfWeek: 2, repeatEveryWeeks: 2, effectiveDate: '2026-12-01' })
    expect(biweekly.status).toBe(201)
    expect(biweekly.body.frequency).toBe('biweekly')
    await remove(biweekly.body.id)
  })

  test('monthly = the same weekday of the month as the start (2nd Tuesday), every month', async () => {
    await setFeatures([...BASE, 'care_shift_repeats'])
    const r = await create({ dayOfWeek: 2, frequency: 'monthly', effectiveDate: '2026-12-08' })
    expect(r.status).toBe(201)
    expect(r.body.frequency).toBe('monthly')
    expect(await days('2026-12-01', '2027-02-28')).toEqual(['2026-12-08', '2027-01-12', '2027-02-09'])
    await remove(r.body.id)
  })

  test('monthly from a 5th weekday means the LAST one of each month', async () => {
    const r = await create({ dayOfWeek: 2, frequency: 'monthly', effectiveDate: '2026-12-29' })
    expect(r.status).toBe(201)
    expect(await days('2026-12-01', '2027-02-28')).toEqual(['2026-12-29', '2027-01-26', '2027-02-23'])
    await remove(r.body.id)
  })

  test('every 3 weeks counts whole weeks from the start; the start moves to the chosen weekday', async () => {
    // 2026-12-01 is a Tuesday. A Wednesday pattern started that day first happens Wednesday 12-02.
    const r = await create({ dayOfWeek: 3, repeatEveryWeeks: 3, effectiveDate: '2026-12-01' })
    expect(r.status).toBe(201)
    expect(r.body.frequency).toBe('every_3_weeks')
    expect(String(r.body.anchorDate).slice(0, 10)).toBe('2026-12-02')
    expect(await days('2026-12-01', '2027-02-28')).toEqual(['2026-12-02', '2026-12-23', '2027-01-13', '2027-02-03', '2027-02-24'])
    await remove(r.body.id)
  })

  test('a bad number, or a way of repeating we do not run, is refused rather than run as weekly', async () => {
    expect((await create({ dayOfWeek: 2, repeatEveryWeeks: 13, effectiveDate: '2026-12-01' })).body.code).toBe('bad_repeat')
    expect((await create({ dayOfWeek: 2, repeatEveryWeeks: 0, effectiveDate: '2026-12-01' })).body.code).toBe('bad_repeat')
    expect((await create({ dayOfWeek: 2, frequency: 'fortnightly', effectiveDate: '2026-12-01' })).body.code).toBe('bad_repeat')
  })

  test('a caregiver cannot create one; editing a shift into a repeat uses the same rules', async () => {
    const denied = await json(await as('ann')('/api/schedules-enhanced', { method: 'POST', json: { caregiverId: ids.ann, clientId: ids.pat, startTime: '09:00', endTime: '11:00', dayOfWeek: 2, frequency: 'monthly', effectiveDate: '2026-12-08' } }))
    expect(denied.status).toBe(403)
    const weekly = await create({ dayOfWeek: 4, effectiveDate: '2026-12-03' })
    expect(weekly.status).toBe(201)
    const put = await json(await as('owner')(`/api/schedules-all/${weekly.body.id}`, { method: 'PUT', json: { scope: 'all', repeatEveryWeeks: 4, effectiveDate: '2026-12-03' } }))
    expect(put.status).toBe(200)
    expect(put.body.frequency).toBe('every_4_weeks')
    expect(await days('2026-12-01', '2027-02-28')).toEqual(['2026-12-03', '2026-12-31', '2027-01-28', '2027-02-25'])
    await setFeatures(BASE)
    const refused = await json(await as('owner')(`/api/schedules-all/${weekly.body.id}`, { method: 'PUT', json: { scope: 'all', frequency: 'monthly' } }))
    expect(refused.body.code).toBe('repeat_not_available')
    await remove(weekly.body.id)
  })
})

// ── required tasks ───────────────────────────────────────────────────────────────────────────
const task = async (extra: any = {}) => json(await as('owner')(`/api/care-tasks/client/${ids.pat}`, { method: 'POST', json: { taskName: 'Lock the back door', category: 'safety', ...extra } }))
const mark = (entryId: string, taskId: string, body: any) => as('ann')(`/api/care-tasks/time-entry/${entryId}/${taskId}`, { method: 'PUT', json: body })
const clockIn = async () => (await json(await as('ann')('/api/time-entries/clock-in', { method: 'POST', json: { clientId: ids.pat, latitude: 44.8, longitude: -91.5 } }))).body
const clockOut = async (id: string) => json(await as('ann')(`/api/time-entries/${id}/clock-out`, { method: 'POST', json: { latitude: 44.8, longitude: -91.5 } }))

describe('home care — required tasks block clock-out (item 12)', () => {
  test('without the feature a task cannot be made required, and nothing blocks the clock-out', async () => {
    const r = await task({ isRequired: true })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('required_tasks_not_available')
    const plain = await task({ taskName: 'Water the plants', category: 'other' })
    expect(plain.status).toBe(200)
    expect(plain.body.isRequired).toBe(false)
    const e = await clockIn()
    const out = await clockOut(e.id)
    expect(out.status).toBe(200)
    await t.db.update(t.schema.clientTaskTemplates).set({ isActive: false } as any).where(eq(t.schema.clientTaskTemplates.clientId, ids.pat))
  })

  test('with it: a required task holds the clock-out until done, or skipped with a reason', async () => {
    await setFeatures([...BASE, 'care_required_tasks'])
    const a = await task({ isRequired: true })
    const b = await task({ taskName: 'Check the stove is off', category: 'safety', isRequired: true })
    const c = await task({ taskName: 'Water the plants', category: 'other' })
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200])
    expect(a.body.isRequired).toBe(true)

    const e = await clockIn()
    const blocked = await clockOut(e.id)
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('required_tasks_pending')
    expect(blocked.body.error).toContain('Lock the back door')
    expect(Object.values(blocked.body.fields).sort()).toEqual(['Check the stove is off', 'Lock the back door'])
    expect((await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, e.id)) as any[])[0].endTime).toBeNull()

    // The optional task is not in the way; done releases one of the two.
    expect((await mark(e.id, a.body.id, { status: 'completed' })).status).toBe(200)
    const still = await clockOut(e.id)
    expect(still.status).toBe(409)
    expect(Object.values(still.body.fields)).toEqual(['Check the stove is off'])

    // A skip needs a reason on a required task; with one it is accepted and the visit can end.
    const noReason = await json(await mark(e.id, b.body.id, { status: 'skipped' }))
    expect(noReason.status).toBe(400)
    expect(noReason.body.code).toBe('skip_needs_reason')
    expect((await clockOut(e.id)).status).toBe(409)
    expect((await mark(e.id, b.body.id, { status: 'skipped', notes: 'Client had a pot on; asked me not to touch it' })).status).toBe(200)
    const out = await clockOut(e.id)
    expect(out.status).toBe(200)
    expect((await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, e.id)) as any[])[0].endTime).not.toBeNull()
  })

  test('the checklist tells the phone which tasks are required', async () => {
    const e = await clockIn()
    const rows = (await json(await as('ann')(`/api/care-tasks/time-entry/${e.id}`))).body.data ?? []
    expect(rows.filter((r: any) => r.isRequired).map((r: any) => r.taskName).sort()).toEqual(['Check the stove is off', 'Lock the back door'])
    // The office force clock-out is never blocked.
    const force = await as('owner')(`/api/time-entries/${e.id}/admin-force-clockout`, { method: 'POST', json: { reason: 'Caregiver forgot' } })
    expect(force.status).toBe(200)
  })

  test('a clock-out the phone saved while offline is recorded and flagged for the office, not refused', async () => {
    const e = await clockIn()
    const out = await json(await as('ann')(`/api/time-entries/${e.id}/clock-out`, { method: 'POST', json: { latitude: 44.8, longitude: -91.5, offlineAt: new Date().toISOString() } }))
    expect(out.status).toBe(200)
    const row = (await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, e.id)) as any[])[0]
    expect(row.needsApproval).toBe(true)
    expect(row.approvalReason).toContain('Required tasks not recorded')
  })

  test('a caregiver cannot make a task required; the screen reads isRequired back', async () => {
    const denied = await json(await as('ann')(`/api/care-tasks/client/${ids.pat}`, { method: 'POST', json: { taskName: 'x', isRequired: true } }))
    expect(denied.status).toBe(403)
    const list = (await json(await as('owner')(`/api/care-tasks/client/${ids.pat}`))).body.data
    expect(list.every((r: any) => typeof r.isRequired === 'boolean')).toBe(true)
    // Required can be switched off again.
    const first = list.find((r: any) => r.isRequired)
    const off = await json(await as('owner')(`/api/care-tasks/${first.id}`, { method: 'PUT', json: { isRequired: false } }))
    expect(off.body.isRequired).toBe(false)
  })
})
