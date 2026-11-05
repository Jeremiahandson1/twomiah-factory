// Home care parity, row 2 (docs/parity/homecare-daily-care-wording.md): medication reminders that remind. Dose times on each
// medicine; a push to the caregiver on the visit when a dose is due; a notice to the office when a dose that fell inside a visit
// was never recorded; the caregiver's own phone settings honoured; doses saved offline count; the agency's on/off and timing.
// All behind care_medication_reminders.
import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { normDoseTimes } from '../server/crm/homecare/core/medicationReminders.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
let tz = ''
let today = ''
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
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const day = (n: number) => addDays(today, -n)
const at = (ymd: string, hm: string) => zonedWallTimeToUtc(ymd, hm, tz)
const ON = ['contacts', 'scheduling', 'team', 'care_medication_reminders']
const notices = async (userId: string, type: string) => (await t.db.select().from(t.schema.notifications)
  .where(and(eq(t.schema.notifications.userId, userId), eq(t.schema.notifications.type, type)))) as any[]
const medFor = (name: string, extra: any = {}) => ins(t.schema.medications, { companyId, clientId: ids.pat, name, dosage: '500mg', doseTimes: ['08:00'], status: 'active', ...extra })
const visit = (d: string, from: string, to: string | null) => ins(t.schema.timeEntries, {
  companyId, caregiverId: ids.ann, clientId: ids.pat, startTime: at(d, from), endTime: to ? at(d, to) : null, isComplete: !!to,
})
const pushedTo = () => t.pushed.filter((m: any) => String(m.to).includes('ann')).map((m: any) => m.body as string)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  tokens.owner = await login('owner@test.example', seeded.password)
  core = createHomecareCore({ services: t.services.crm } as any)
  tz = await core.time.timezone(companyId)
  today = await core.time.today(companyId)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  const ann = await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })
  ids.ann = ann.id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  // Ann's phone.
  expect((await as('ann')('/api/push/expo-token', { method: 'POST', json: { token: 'ExponentPushToken[ann-phone]' } })).status).toBe(201)
  await setFeatures(ON)
}, 90_000)

// Each test has a client of its own (so one test's medicines never show up in another's scan), and a caregiver holds one open
// visit at a time, so whatever a test left open is closed after it.
beforeEach(async () => {
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
})
const closeOpenVisits = async () => { await t.db.update(t.schema.timeEntries).set({ endTime: sql`start_time + INTERVAL '1 minute'`, isComplete: true } as any).where(isNull(t.schema.timeEntries.endTime)) }
afterEach(closeOpenVisits)

// A quiet-hours window around the agency's clock right now (the send gate asks the real time, not the scan's `at`).
const quiet = async () => {
  const h = Number((await core.time.now(companyId)).time.slice(0, 2))
  const hh = (n: number) => `${String((n + 24) % 24).padStart(2, '0')}:00`
  return { quietHoursStart: hh(h - 1), quietHoursEnd: hh(h + 2) }
}

describe('home care parity row 2 — dose times', () => {
  test('dose times are tidied: HH:MM, sorted, de-duplicated; anything else is refused in plain words', () => {
    expect(normDoseTimes(['20:00', '8:00', '08:00'])).toEqual({ times: ['08:00', '20:00'] })
    expect(normDoseTimes(null)).toEqual({ times: [] })
    expect(normDoseTimes(['25:00'])).toHaveProperty('error')
    expect(normDoseTimes(['soon'])).toHaveProperty('error')
    expect(normDoseTimes('08:00')).toHaveProperty('error')
    expect(normDoseTimes(Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, '0')}:00`))).toHaveProperty('error')
  })

  test('the office sets them on the medicine, they come back on the list, and an empty list clears them', async () => {
    const made = await json(await as('owner')('/api/medications', { method: 'POST', json: { clientId: ids.pat, medicationName: 'Lisinopril', doseTimes: ['20:00', '8:00'] } }))
    expect(made.status).toBe(201)
    expect(made.body.doseTimes).toEqual(['08:00', '20:00'])
    const bad = await json(await as('owner')(`/api/medications/${made.body.id}`, { method: 'PUT', json: { doseTimes: ['99:99'] } }))
    expect(bad.status).toBe(400)
    const list = await json(await as('owner')(`/api/medications/client/${ids.pat}`))
    expect(list.body.data.find((m: any) => m.id === made.body.id).doseTimes).toEqual(['08:00', '20:00'])
    const cleared = await json(await as('owner')(`/api/medications/${made.body.id}`, { method: 'PUT', json: { doseTimes: [] } }))
    expect(cleared.body.doseTimes).toBeNull()
  })
})

describe('home care parity row 2 — the agency\'s choices and the feature', () => {
  test('with the feature off the settings are closed to a signed-in user (403) and nothing is sent', async () => {
    await setFeatures(['contacts', 'scheduling', 'team'])
    expect((await as('owner')('/api/medication-reminders/settings')).status).toBe(403)
    const d = day(20)
    const med = await medFor('Offfeature')
    await visit(d, '07:50', null)
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '07:55'))).toBe(0)
    await t.db.update(t.schema.medications).set({ status: 'discontinued' } as any).where(eq(t.schema.medications.id, med.id))
    await setFeatures(ON)
  })

  test('the choices default on, ten minutes before, an hour after; the office changes them from the list; anything else is refused', async () => {
    const now = await json(await as('owner')('/api/medication-reminders/settings'))
    expect(now.body).toMatchObject({ enabled: true, leadMinutes: 10, officeGraceMinutes: 60, leadChoices: [0, 5, 10, 15, 30] })
    expect((await json(await as('owner')('/api/medication-reminders/settings', { method: 'PUT', json: { leadMinutes: 7 } }))).status).toBe(400)
    expect((await json(await as('owner')('/api/medication-reminders/settings', { method: 'PUT', json: { officeGraceMinutes: 5 } }))).status).toBe(400)
    expect((await json(await as('owner')('/api/medication-reminders/settings', { method: 'PUT', json: { enabled: 'yes' } }))).status).toBe(400)
    const saved = await json(await as('owner')('/api/medication-reminders/settings', { method: 'PUT', json: { leadMinutes: 5 } }))
    expect(saved.body).toMatchObject({ enabled: true, leadMinutes: 5, officeGraceMinutes: 60 })
    expect((await json(await as('ann')('/api/medication-reminders/settings', { method: 'PUT', json: { leadMinutes: 0 } }))).status).toBe(403)
    await as('owner')('/api/medication-reminders/settings', { method: 'PUT', json: { leadMinutes: 10 } })
  })
})

describe('home care parity row 2 — the reminder to the caregiver', () => {
  test('a dose due is pushed to the caregiver clocked in at that client — once — and not before the lead time', async () => {
    const d = day(1)
    const med = await medFor('Metformin')
    const v = await visit(d, '07:30', null)
    const before = t.pushed.length
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '07:45'))).toBe(0) // 15 min ahead: not yet (lead 10)
    expect(t.pushed.length).toBe(before)
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '07:52'))).toBe(1)
    const sent = t.pushed.slice(before).filter((m: any) => String(m.to).includes('ann'))
    expect(sent.length).toBe(1)
    expect(sent[0].title).toBe('Medication due')
    expect(sent[0].body).toBe('Pat Client: Metformin 500mg, due 8:00 AM')
    expect(sent[0].data).toMatchObject({ medicationId: med.id, clientId: ids.pat, timeEntryId: v.id })
    expect((await notices(ids.ann, 'medication_due')).some((n) => n.message.includes('Metformin'))).toBe(true)
    // the next scans do not send it again
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '07:57'))).toBe(0)
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '08:20'))).toBe(0)
    expect(t.pushed.length).toBe(before + 1)
  })

  test('a caregiver who clocks in late for a dose is still told (up to an hour after); one who is not clocked in is not', async () => {
    const d = day(2)
    await medFor('Latepill')
    await visit(d, '08:20', null)
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '08:25'))).toBe(1)
    const e = day(3)
    await medFor('Nobodyhome')
    expect(await core.medicationReminders.scanCompany(companyId, at(e, '07:55'))).toBe(0) // no open visit
    await visit(e, '06:00', '07:00') // a visit that already ended is not a visit to remind
    expect(await core.medicationReminders.scanCompany(companyId, at(e, '07:55'))).toBe(0)
  })

  test('a dose that is recorded already is not reminded — including one saved on a phone without signal, sent late', async () => {
    const d = day(4)
    const med = await medFor('Offlinepill')
    await t.db.update(t.schema.company).set({ enabledFeatures: [...ON, 'care_offline_saves'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    await visit(d, '07:30', null)
    // Ann tapped "given" at 07:56 with no signal; the phone sent it after the 08:05 scan would have run.
    const saved = await json(await as('owner')('/api/medications/log', { method: 'POST', json: {
      medicationId: med.id, clientId: ids.pat, caregiverId: ids.ann, status: 'given', scheduledTime: at(d, '08:00').toISOString(), savedAt: at(d, '07:56').toISOString(),
    } }))
    expect(saved.status).toBe(201)
    const before = t.pushed.length
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '08:05'))).toBe(0)
    expect(t.pushed.length).toBe(before)
    await setFeatures(ON)
  })

  test('the caregiver\'s phone switch is honoured: push off means no push (the in-app notice stays)', async () => {
    const d = day(5)
    await medFor('Switchoff')
    await visit(d, '07:30', null)
    await ins(t.schema.notificationPreferences, { companyId, userId: ids.ann, pushEnabled: false })
    t.services.crm && (core.prefs as any).invalidate(ids.ann)
    const before = pushedTo().length
    await core.medicationReminders.scanCompany(companyId, at(d, '07:55'))
    expect(pushedTo().length).toBe(before)
    expect((await notices(ids.ann, 'medication_due')).some((n) => n.message.includes('Switchoff'))).toBe(true)
    await t.db.update(t.schema.notificationPreferences).set({ pushEnabled: true } as any).where(eq(t.schema.notificationPreferences.userId, ids.ann))
    ;(core.prefs as any).invalidate(ids.ann)
  })

  test('quiet hours: a dose reminder is urgent and goes through, unless the caregiver turned urgent alerts off', async () => {
    const d = day(6)
    await medFor('Quietpill')
    await visit(d, '07:30', null)
    await t.db.update(t.schema.notificationPreferences).set({ ...(await quiet()), quietHoursSkipEmergency: true } as any).where(eq(t.schema.notificationPreferences.userId, ids.ann))
    ;(core.prefs as any).invalidate(ids.ann)
    let n = pushedTo().length
    await core.medicationReminders.scanCompany(companyId, at(d, '07:55'))
    expect(pushedTo().length).toBe(n + 1)
    await closeOpenVisits()
    ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
    const e = day(7)
    await medFor('Quietoff')
    await visit(e, '07:30', null)
    await t.db.update(t.schema.notificationPreferences).set({ ...(await quiet()), quietHoursSkipEmergency: false } as any).where(eq(t.schema.notificationPreferences.userId, ids.ann))
    ;(core.prefs as any).invalidate(ids.ann)
    n = pushedTo().length
    await core.medicationReminders.scanCompany(companyId, at(e, '07:55'))
    expect(pushedTo().length).toBe(n)
    await t.db.update(t.schema.notificationPreferences).set({ quietHoursStart: null, quietHoursEnd: null, quietHoursSkipEmergency: true } as any).where(eq(t.schema.notificationPreferences.userId, ids.ann))
    ;(core.prefs as any).invalidate(ids.ann)
  })

  test('the agency can switch reminders off, and set how early the caregiver is told', async () => {
    const d = day(8)
    await medFor('Agencyoff')
    await visit(d, '07:30', null)
    await core.medicationReminders.setSettings(companyId, { enabled: false })
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '07:55'))).toBe(0)
    await core.medicationReminders.setSettings(companyId, { enabled: true, leadMinutes: 30 })
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '07:35'))).toBeGreaterThanOrEqual(1) // 25 min ahead, lead 30
    await core.medicationReminders.setSettings(companyId, { leadMinutes: 10 })
  })

  test('a medicine outside its start and end dates, or as-needed, is not reminded', async () => {
    const d = day(9)
    await medFor('Ended', { endDate: addDays(d, -1) })
    await medFor('Notyet', { startDate: addDays(d, 1) })
    await medFor('Asneeded', { isPrn: true })
    await visit(d, '07:30', null)
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '07:55'))).toBe(0)
  })
})

describe('home care parity row 2 — the office hears of a dose nobody recorded', () => {
  test('after the visit ends and the grace passes, a dose inside it with no record is told to the office — once', async () => {
    const d = day(10)
    const med = await medFor('Missedpill')
    await visit(d, '07:30', '08:30')
    const owner = ids.owner
    const had = (await notices(owner, 'medication_not_recorded')).length
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '09:00'))).toBe(0) // only 30 min after: still inside the 60-minute grace
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '09:35'))).toBe(1)
    const got = (await notices(owner, 'medication_not_recorded')).slice(had)
    expect(got.length).toBe(1)
    expect(got[0].message).toContain('Pat Client: Missedpill 500mg was due at 8:00 AM')
    expect(got[0].message).toContain('Ann Carer')
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '12:00'))).toBe(0)
    expect((await notices(owner, 'medication_not_recorded')).length).toBe(had + 1)
    void med
  })

  test('a dose given, refused, held or saved offline (tap time inside the visit) is an answer; so is a dose outside the visit', async () => {
    const d = day(11)
    const given = await medFor('Givenpill')
    const refused = await medFor('Refusedpill', { doseTimes: ['08:10'] })
    const outside = await medFor('Outsidepill', { doseTimes: ['12:00'] })
    await visit(d, '07:30', '08:30')
    await ins(t.schema.medicationLogs, { companyId, medicationId: given.id, clientId: ids.pat, caregiverId: ids.ann, administeredAt: at(d, '08:02'), status: 'given', effectiveStatus: 'given' })
    await ins(t.schema.medicationLogs, { companyId, medicationId: refused.id, clientId: ids.pat, caregiverId: ids.ann, administeredAt: at(d, '08:12'), status: 'refused', effectiveStatus: 'refused' })
    const had = (await notices(ids.owner, 'medication_not_recorded')).length
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '10:00'))).toBe(0)
    expect((await notices(ids.owner, 'medication_not_recorded')).length).toBe(had)
    void outside
  })

  test('a save that arrives inside the grace is counted: the office is not told of a dose the phone had recorded', async () => {
    const d = day(12)
    const med = await medFor('Latesave')
    await visit(d, '07:30', '08:30')
    const had = (await notices(ids.owner, 'medication_not_recorded')).length
    await ins(t.schema.medicationLogs, { companyId, medicationId: med.id, clientId: ids.pat, caregiverId: ids.ann, administeredAt: at(d, '08:01'), status: 'given', effectiveStatus: 'given' }) // tapped 08:01, arrived 09:20
    expect(await core.medicationReminders.scanCompany(companyId, at(d, '09:35'))).toBe(0)
    expect((await notices(ids.owner, 'medication_not_recorded')).length).toBe(had)
  })
})
