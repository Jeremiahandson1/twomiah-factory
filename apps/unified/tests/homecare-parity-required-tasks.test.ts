// Home care parity row 5 (docs/parity/homecare-required-tasks-repeats.md): a task's days of the week and time of day are READ (a Tuesday
// task holds only a Tuesday visit), the client's signature on every visit with a reason list, the EVV report that every assigned task was
// done or skipped with a reason, and one repeating shift on several weekdays. Behind care_required_tasks, care_visit_signature and
// care_shift_repeats.
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { eq, isNull, sql } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { parseTaskDays, taskBelongsTo, describeDays, visitWhen } from '../server/crm/homecare/core/taskDays.ts'
import { reasonLabel } from '../server/crm/homecare/core/visitSignature.ts'
import { addDays, ymdIn } from '../server/crm/homecare/core/agencyTime.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const TZ = 'America/Chicago'
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
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const nowLocal = () => {
  const at = new Date()
  const day = ymdIn(at, TZ)
  const [y, m, d] = day.split('-').map(Number)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(at))
  return { day, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), hour }
}
const task = (over: any = {}) => ins(t.schema.clientTaskTemplates, { companyId, clientId: ids.pat, taskName: 'Task', category: 'adl', isRequired: true, ...over })
const open = async (clientId = ids.pat) => (await json(await as('ann')('/api/time-entries/clock-in', { method: 'POST', json: { clientId, latitude: 44.8, longitude: -91.5 } }))).body.id as string
const clockOut = async (visit: string, b: any = { notes: 'fine' }) => json(await as('ann')(`/api/time-entries/${visit}/clock-out`, { method: 'POST', json: b }))
const mark = async (visit: string, taskId: string, b: any) => json(await as('ann')(`/api/care-tasks/time-entry/${visit}/${taskId}`, { method: 'PUT', json: b }))

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  for (const who of ['ann', 'bob']) {
    ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId })).id
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
  }
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  await ins(t.schema.clientAssignments, { companyId, clientId: ids.pat, caregiverId: ids.ann, assignmentDate: '2026-10-01', status: 'active' })
  await setFeatures([...BASE, 'care_required_tasks'])
}, 90_000)
beforeEach(async () => {
  await t.db.update(t.schema.timeEntries).set({ endTime: sql`start_time + INTERVAL '1 minute'`, isComplete: true } as any).where(isNull(t.schema.timeEntries.endTime))
  await t.db.delete(t.schema.clientTaskTemplates)
  await t.db.delete(t.schema.visitSignature)
  await setFeatures([...BASE, 'care_required_tasks'])
  await t.db.update(t.schema.company).set({ settings: {} } as any).where(eq(t.schema.company.id, companyId))
})

describe('row 5 — reading a task\'s days and time of day (pure)', () => {
  test('day text in the ways an office types it', () => {
    expect(parseTaskDays('Mon,Wed,Fri')).toEqual({ ok: true, days: [1, 3, 5] })
    expect(parseTaskDays('Tuesdays')).toEqual({ ok: true, days: [2] })
    expect(parseTaskDays('Mon-Fri')).toEqual({ ok: true, days: [1, 2, 3, 4, 5] })
    expect(parseTaskDays('Fri-Mon')).toEqual({ ok: true, days: [0, 1, 5, 6] }) // a range may wrap the weekend
    expect(parseTaskDays('weekdays')).toEqual({ ok: true, days: [1, 2, 3, 4, 5] })
    expect(parseTaskDays('Sat and Sun')).toEqual({ ok: true, days: [0, 6] })
    expect(parseTaskDays('Mon Wed Fri')).toEqual({ ok: true, days: [1, 3, 5] })
    expect(parseTaskDays('Daily')).toEqual({ ok: true, days: null })
    expect(parseTaskDays('')).toEqual({ ok: true, days: null })
    expect(parseTaskDays(null)).toEqual({ ok: true, days: null })
    expect(parseTaskDays('Sun,Mon,Tue,Wed,Thu,Fri,Sat')).toEqual({ ok: true, days: null })
    expect(parseTaskDays('whenever')).toEqual({ ok: false, days: null }) // not readable: the task behaves as it always did
    expect(describeDays([1, 3, 5])).toBe('Monday, Wednesday and Friday')
  })

  test('a task belongs only to a visit on its day and time of day', () => {
    const tue = { dow: 2, startMin: 9 * 60, endMin: 11 * 60, spansDays: false }
    expect(taskBelongsTo({ daysOfWeek: 'Tue', timeOfDay: 'any' }, tue)).toBe(true)
    expect(taskBelongsTo({ daysOfWeek: 'Tue', timeOfDay: 'any' }, { ...tue, dow: 3 })).toBe(false)
    expect(taskBelongsTo({ daysOfWeek: null, timeOfDay: 'any' }, { ...tue, dow: 3 })).toBe(true)
    expect(taskBelongsTo({ daysOfWeek: 'whenever', timeOfDay: 'any' }, { ...tue, dow: 3 })).toBe(true)
    expect(taskBelongsTo({ timeOfDay: 'AM' }, tue)).toBe(true)
    expect(taskBelongsTo({ timeOfDay: 'PM' }, tue)).toBe(false) // a 9–11 morning visit
    const afternoon = { dow: 2, startMin: 14 * 60, endMin: 16 * 60, spansDays: false }
    expect(taskBelongsTo({ timeOfDay: 'AM' }, afternoon)).toBe(false)
    expect(taskBelongsTo({ timeOfDay: 'PM' }, afternoon)).toBe(true)
    const across = { dow: 2, startMin: 10 * 60, endMin: 14 * 60, spansDays: false } // 10–2 covers both halves
    expect(taskBelongsTo({ timeOfDay: 'AM' }, across)).toBe(true)
    expect(taskBelongsTo({ timeOfDay: 'PM' }, across)).toBe(true)
  })

  test('the visit\'s day and time are the agency\'s, not the server\'s', () => {
    // 2026-11-03 03:30 UTC is still Monday 9:30 PM in Chicago (CST).
    const when = visitWhen(new Date('2026-11-03T03:30:00Z'), new Date('2026-11-03T04:30:00Z'), TZ)
    expect(when.dow).toBe(1)
    expect(when.startMin).toBe(21 * 60 + 30)
  })
})

describe('row 5 — a required task holds only the visits it belongs to', () => {
  test('a task for another weekday does not hold today\'s clock-out; one for today does', async () => {
    const n = nowLocal()
    const other = (n.dow + 3) % 7
    const forToday = await task({ taskName: 'Today only', daysOfWeek: NAMES[n.dow] })
    await task({ taskName: 'Another day', daysOfWeek: NAMES[other] })
    const v = await open()
    const held = await clockOut(v)
    expect(held.status).toBe(409)
    expect(held.body.code).toBe('required_tasks_pending')
    expect(held.body.error).toContain('Today only')
    expect(held.body.error).not.toContain('Another day')
    expect((await mark(v, forToday.id, { status: 'completed' })).status).toBe(200)
    expect((await clockOut(v)).status).toBe(200)
  })

  test('with only a task for another weekday the visit clocks out freely (the failing case before this change)', async () => {
    const n = nowLocal()
    await task({ taskName: 'Another day', daysOfWeek: NAMES[(n.dow + 2) % 7] })
    const v = await open()
    expect((await clockOut(v)).status).toBe(200)
  })

  test('an AM task does not hold an afternoon visit, and a PM task does not hold a morning one', async () => {
    const n = nowLocal()
    await task({ taskName: n.hour < 12 ? 'Evening meds' : 'Morning meds', timeOfDay: n.hour < 12 ? 'PM' : 'AM' })
    const v = await open()
    expect((await clockOut(v)).status).toBe(200)
  })

  test('the checklist says which tasks belong to this visit, for the phone to show', async () => {
    const n = nowLocal()
    await task({ taskName: 'Mine', daysOfWeek: NAMES[n.dow], isRequired: false })
    await task({ taskName: 'Not mine', daysOfWeek: NAMES[(n.dow + 1) % 7], isRequired: false })
    const v = await open()
    const list = (await json(await as('ann')(`/api/care-tasks/time-entry/${v}`))).body.data as any[]
    expect(list.find((x) => x.taskName === 'Mine').appliesToVisit).toBe(true)
    expect(list.find((x) => x.taskName === 'Not mine').appliesToVisit).toBe(false)
  })

  test('without the feature days and times stay labels: every task shows as belonging', async () => {
    await setFeatures(BASE)
    const n = nowLocal()
    await task({ taskName: 'Not mine', daysOfWeek: NAMES[(n.dow + 1) % 7], isRequired: false })
    const v = await open()
    const list = (await json(await as('ann')(`/api/care-tasks/time-entry/${v}`))).body.data as any[]
    expect(list[0].appliesToVisit).toBe(true)
  })

  test('days we cannot read are refused in plain words when the feature is on, and accepted when it is off', async () => {
    const bad = await json(await as('owner')(`/api/care-tasks/client/${ids.pat}`, { method: 'POST', json: { taskName: 'Water plants', daysOfWeek: 'whenever' } }))
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('bad_days')
    expect(bad.body.error).toContain('whenever')
    const good = await json(await as('owner')(`/api/care-tasks/client/${ids.pat}`, { method: 'POST', json: { taskName: 'Water plants', daysOfWeek: 'Mon, Thu' } }))
    expect(good.status).toBe(200)
    await setFeatures(BASE)
    expect((await json(await as('owner')(`/api/care-tasks/client/${ids.pat}`, { method: 'POST', json: { taskName: 'Water plants 2', daysOfWeek: 'whenever' } }))).status).toBe(200)
  })
})

describe('row 5 — the client\'s signature on every visit', () => {
  const ON = [...BASE, 'care_visit_signature']
  const SVG = 'data:image/svg+xml;base64,PHN2Zy8+'
  const sign = async (visit: string, b: any, who = 'ann') => json(await as(who)(`/api/visit-signature/visit/${visit}`, { method: 'PUT', json: b }))
  const require_ = async (on = true) => json(await as('owner')('/api/visit-signature/settings', { method: 'PUT', json: { required: on } }))

  test('the feature is off by default: the routes answer 403 and a clock-out is never held', async () => {
    expect((await json(await as('ann')('/api/visit-signature/config'))).status).toBe(403)
    const v = await open()
    expect((await clockOut(v)).status).toBe(200)
  })

  test('the agency can require it; the phone reads the rule and the reason list; a caregiver cannot change the rule', async () => {
    await setFeatures(ON)
    expect((await require_()).body.required).toBe(true)
    const cfg = (await json(await as('ann')('/api/visit-signature/config'))).body
    expect(cfg.required).toBe(true)
    expect(cfg.reasons.map((r: any) => r.code)).toContain('asleep')
    expect(cfg.reasons.every((r: any) => r.label && r.label !== r.code)).toBe(true)
    expect((await json(await as('ann')('/api/visit-signature/settings', { method: 'PUT', json: { required: false } }))).status).toBe(403)
    expect((await json(await as('owner')('/api/visit-signature/settings', { method: 'PUT', json: { required: 'yes' } }))).status).toBe(400)
  })

  test('a required signature holds the live clock-out; a drawn signature (with the time) lets it through', async () => {
    await setFeatures(ON); await require_()
    const v = await open()
    const held = await clockOut(v)
    expect(held.status).toBe(409)
    expect(held.body.code).toBe('signature_required')
    const saved = await sign(v, { signature: SVG })
    expect(saved.status).toBe(200)
    expect(saved.body.signature.signed).toBe(true)
    expect(saved.body.signature.signedAt).toBeTruthy()
    expect((await clockOut(v)).status).toBe(200)
  })

  test('a reason from the list also lets it through; "another reason" needs the reason written; both together are refused', async () => {
    await setFeatures(ON); await require_()
    const v = await open()
    expect((await sign(v, { reasonCode: 'other' })).body.code).toBe('reason_note_required')
    expect((await sign(v, { reasonCode: 'nonsense' })).body.code).toBe('bad_reason')
    expect((await sign(v, { signature: SVG, reasonCode: 'asleep' })).body.code).toBe('signature_or_reason')
    expect((await sign(v, {})).body.code).toBe('signature_or_reason')
    expect((await sign(v, { signature: 'not a picture' })).body.code).toBe('bad_signature')
    const ok = await sign(v, { reasonCode: 'asleep' })
    expect(ok.status).toBe(200)
    expect(ok.body.signature.signed).toBe(false)
    expect(ok.body.signature.reasonLabel).toBe(reasonLabel('asleep'))
    expect((await clockOut(v)).status).toBe(200)
  })

  test('signing again replaces the earlier one; only the visit\'s own caregiver (or the office) can record it', async () => {
    await setFeatures(ON)
    const v = await open()
    await sign(v, { reasonCode: 'asleep' })
    await sign(v, { signature: SVG })
    const got = (await json(await as('owner')(`/api/visit-signature/visit/${v}`))).body
    expect(got.signature.signed).toBe(true)
    expect(got.signature.reasonCode).toBeNull()
    expect((await sign(v, { reasonCode: 'asleep' }, 'bob')).status).toBe(403)
  })

  test('the signature rides in the clock-out body (how an offline clock-out carries it), with the time the client signed', async () => {
    await setFeatures([...ON, 'care_offline_saves']); await require_()
    const v = await open()
    const at = new Date(Date.now() - 20 * 60_000).toISOString()
    const out = await clockOut(v, { notes: 'fine', signature: { signature: SVG, savedAt: at } })
    expect(out.status).toBe(200)
    const rec = (await json(await as('owner')(`/api/visit-signature/visit/${v}`))).body.signature
    expect(rec.signed).toBe(true)
    expect(new Date(rec.signedAt).toISOString()).toBe(at)
  })

  test('a clock-out saved offline without a signature is let through and flagged for the office, not refused', async () => {
    await setFeatures(ON); await require_()
    const v = await open()
    const out = await clockOut(v, { notes: 'fine', offlineAt: new Date(Date.now() - 60_000).toISOString() })
    expect(out.status).toBe(200)
    expect(out.body.needsApproval).toBe(true)
    expect(out.body.approvalReason).toContain('No client signature or reason')
  })
})

describe('row 5 — the EVV report: was every assigned task done?', () => {
  const report = async (q = '', who = 'owner') => json(await as(who)(`/api/evv-task-report${q}`))
  const today = () => nowLocal().day

  test('each visit lists its tasks as done, skipped with a reason, or not recorded — only the tasks that belong to it', async () => {
    const n = nowLocal()
    const a = await task({ taskName: 'Bathing', daysOfWeek: NAMES[n.dow], isRequired: false })
    const b = await task({ taskName: 'Laundry', daysOfWeek: NAMES[n.dow], isRequired: false })
    await task({ taskName: 'Garden', daysOfWeek: NAMES[n.dow], isRequired: false })
    await task({ taskName: 'Other day', daysOfWeek: NAMES[(n.dow + 1) % 7], isRequired: false })
    const v = await open()
    await mark(v, a.id, { status: 'completed' })
    await mark(v, b.id, { status: 'skipped', notes: 'Client had no laundry' })
    await clockOut(v)
    const r = await report(`?from=${today()}&to=${today()}`)
    expect(r.status).toBe(200)
    const visit = r.body.visits.find((x: any) => x.timeEntryId === v)
    const by = Object.fromEntries(visit.tasks.map((x: any) => [x.taskName, x]))
    expect(Object.keys(by).sort()).toEqual(['Bathing', 'Garden', 'Laundry']) // "Other day" does not belong to this visit
    expect(by.Bathing.state).toBe('done')
    expect(by.Laundry.state).toBe('skipped')
    expect(by.Laundry.reason).toBe('Client had no laundry')
    expect(by.Garden.state).toBe('not_recorded')
    expect(by.Garden.stateLabel).toBe('Not recorded')
    expect(visit.complete).toBe(false)
    expect(visit.missing).toBe(1)
    expect(r.body.summary.visitsWithGaps).toBeGreaterThanOrEqual(1)
  })

  test('a skip without a written reason does not count; a complete visit says so; onlyGaps hides complete visits', async () => {
    const a = await task({ taskName: 'Bathing', isRequired: false })
    const v1 = await open()
    await mark(v1, a.id, { status: 'skipped' }) // no reason: allowed for a task that is not required, but it is not accounted for
    await clockOut(v1)
    const v2 = await open()
    await mark(v2, a.id, { status: 'completed' })
    await clockOut(v2)
    const all = (await report(`?from=${today()}&to=${today()}`)).body.visits
    expect(all.find((x: any) => x.timeEntryId === v1).complete).toBe(false)
    expect(all.find((x: any) => x.timeEntryId === v2).complete).toBe(true)
    const gaps = (await report(`?from=${today()}&to=${today()}&onlyGaps=true`)).body.visits
    expect(gaps.map((x: any) => x.timeEntryId)).toContain(v1)
    expect(gaps.map((x: any) => x.timeEntryId)).not.toContain(v2)
  })

  test('a weekly task done earlier in the week is accounted for on the week\'s other visits', async () => {
    const w = await task({ taskName: 'Change bed linen', cadence: 'weekly', isRequired: false })
    const v1 = await open()
    await mark(v1, w.id, { status: 'completed' })
    await clockOut(v1)
    const v2 = await open()
    await clockOut(v2)
    const visits = (await report(`?from=${today()}&to=${today()}`)).body.visits
    expect(visits.find((x: any) => x.timeEntryId === v2).tasks[0].state).toBe('done_earlier')
    expect(visits.find((x: any) => x.timeEntryId === v2).complete).toBe(true)
  })

  test('the same list downloads as a spreadsheet file; the window is checked; the office only', async () => {
    const a = await task({ taskName: '=1+1 Bathing', isRequired: false })
    const v = await open()
    await mark(v, a.id, { status: 'completed' })
    await clockOut(v)
    const csv = await as('owner')(`/api/evv-task-report?from=${today()}&to=${today()}&format=csv`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const text = await csv.text()
    expect(text.split('\n')[0]).toBe('Visit date,Start,End,Client,Caregiver,Task,Required,Result,Reason,Visit complete,Client signature')
    expect(text).toContain("'=1+1 Bathing") // a spreadsheet formula in a task name is neutralised
    expect(text).toContain('Pat Client')
    expect((await report('?from=2026-01-01&to=2026-12-31')).body.code).toBe('bad_range')
    expect((await report('?from=bad&to=worse')).status).toBe(400)
    expect((await report('', 'ann')).status).toBe(403)
  })

  test('the report says whether the client signed', async () => {
    await setFeatures([...BASE, 'care_required_tasks', 'care_visit_signature'])
    const v = await open()
    await json(await as('ann')(`/api/visit-signature/visit/${v}`, { method: 'PUT', json: { reasonCode: 'refused' } }))
    await clockOut(v)
    const visit = (await report(`?from=${today()}&to=${today()}`)).body.visits.find((x: any) => x.timeEntryId === v)
    expect(visit.signature).toBe('reason')
    expect(visit.signatureReason).toBe(reasonLabel('refused'))
  })

  test('without the feature the report answers 403', async () => {
    await setFeatures(BASE)
    expect((await report(`?from=${today()}&to=${today()}`)).status).toBe(403)
  })
})

describe('row 5 — one repeating shift on several weekdays', () => {
  const ON = [...BASE, 'care_shift_repeats']
  // The first Wednesday after today, so the series starts in the future and nothing is pulled forward.
  const firstWed = () => { const n = nowLocal(); return addDays(n.day, ((3 - n.dow + 7) % 7) || 7) }
  const make = async (b: any) => json(await as('owner')('/api/schedules-enhanced', { method: 'POST', json: { caregiverId: ids.ann, clientId: ids.pat, scheduleType: 'recurring', startTime: '09:00', endTime: '11:00', ...b } }))
  const dates = async (from: string, to: string) => ((await json(await as('owner')(`/api/schedules/${ids.ann}/occurrences?from=${from}&to=${to}`))).body.occurrences as any[]).map((o) => o.date)
  const active = async () => (await t.db.select().from(t.schema.schedules).where(eq(t.schema.schedules.isActive, true))) as any[]
  beforeEach(async () => { await t.db.delete(t.schema.schedules); await setFeatures(ON) })

  test('Monday, Wednesday and Friday in one request: three rows tied by one series id, every week', async () => {
    const w = firstWed()
    const r = await make({ daysOfWeek: [1, 3, 5], effectiveDate: w, frequency: 'weekly' })
    expect(r.status).toBe(201)
    expect(r.body.series).toBe(true)
    expect(r.body.rows.map((x: any) => x.dayOfWeek)).toEqual([1, 3, 5])
    expect(new Set(r.body.rows.map((x: any) => x.repeatGroupId)).size).toBe(1)
    expect(r.body.repeatGroupId).toBeTruthy()
    expect(await dates(w, addDays(w, 6))).toEqual([w, addDays(w, 2), addDays(w, 5)]) // Wed, Fri, then next Monday
  })

  test('every other week on Monday and Wednesday: both days fall in the same weeks', async () => {
    const w = firstWed()
    const r = await make({ daysOfWeek: [1, 3], effectiveDate: w, repeatEveryWeeks: 2 })
    expect(r.status).toBe(201)
    // Week of the Wednesday is week 0 (its Monday came before the start date); then the weeks two later: Mon and Wed of each.
    expect(await dates(w, addDays(w, 27))).toEqual([w, addDays(w, 12), addDays(w, 14), addDays(w, 26)])
  })

  test('all or none: if one weekday is already taken nothing is created, and the reply names the day', async () => {
    const w = firstWed()
    expect((await make({ dayOfWeek: 3, effectiveDate: w })).status).toBe(201) // a Wednesday shift already exists
    const before = (await active()).length
    const r = await make({ daysOfWeek: [1, 3, 5], effectiveDate: w })
    expect(r.status).toBe(409)
    expect(r.body.error).toContain('Wednesday')
    expect((await active()).length).toBe(before)
  })

  test('the series can be stopped together; the default still stops one weekday', async () => {
    const w = firstWed()
    const r = await make({ daysOfWeek: [1, 3, 5], effectiveDate: w })
    const [mon, wed] = r.body.rows
    const one = await json(await as('owner')(`/api/schedules/${mon.id}?scope=purge`, { method: 'DELETE' }))
    expect(one.body.deletedCount).toBe(1)
    expect((await active()).length).toBe(2)
    const all = await json(await as('owner')(`/api/schedules/${wed.id}?scope=purge&series=true`, { method: 'DELETE' }))
    expect(all.body.deletedCount).toBe(2)
    expect((await active()).length).toBe(0)
  })

  test('a monthly or split shift is made one weekday at a time; one weekday in the list is an ordinary shift; bad lists are refused', async () => {
    const w = firstWed()
    expect((await make({ daysOfWeek: [1, 3], effectiveDate: w, frequency: 'monthly' })).body.code).toBe('bad_weekdays')
    expect((await make({ daysOfWeek: [1, 9], effectiveDate: w })).body.code).toBe('bad_weekdays')
    expect((await make({ daysOfWeek: 'Mon', effectiveDate: w })).body.code).toBe('bad_weekdays')
    const one = await make({ daysOfWeek: [3], effectiveDate: w })
    expect(one.status).toBe(201)
    expect(one.body.series).toBeUndefined()
  })

  test('without care_shift_repeats several weekdays in one request are refused (the screen then makes them one at a time)', async () => {
    await setFeatures(BASE)
    const r = await make({ daysOfWeek: [1, 3], effectiveDate: firstWed() })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('repeat_not_available')
  })
})
