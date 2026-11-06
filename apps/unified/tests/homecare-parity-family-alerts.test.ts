// Home care parity row 7, the extras (docs/parity/homecare-family-text.md), behind care_family_comms with care_family_texts:
//   · the arrival / finish notice as an app notice (web push) on a relative's own phone or browser, which they turn on themselves;
//   · the exact words a relative agreed to for the EMAILS, kept with that yes (the texts already kept theirs);
//   · alert rules the agency writes: when (arrival, finish, arrival N minutes after the scheduled start), who (relatives, the office,
//     the caregiver), how (text, email, app notice), in its own words — once per rule, visit, person and channel.
// Real database; the texting service, the mailer and both push services are fakes (nothing reaches a real phone).
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { emailConsentWording } from '../server/crm/homecare/core/familyComms.ts'
import { readRule } from '../server/crm/homecare/core/alertRules.ts'
import { wordingProblem } from '../server/crm/homecare/core/familyComms.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const texts: any[] = []
const emails: any[] = []
const pushes: { payload: any }[] = []
const staffPushes: { userId: string; payload: any }[] = []
const ON = ['contacts', 'scheduling', 'team', 'care_family_texts', 'care_family_comms']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (p: Response | Promise<Response>) => { const r = await p; return { status: r.status, body: await r.json() as any } }
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const fam = (who: string) => (p: string, init: any = {}) => t.call(`/api/family-portal${p}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const office = (p: string, init: any = {}) => as('owner')(`/api/family-comms${p}`, init)
const member = async (id: string) => ((await t.db.select().from(t.schema.familyMembers).where(eq(t.schema.familyMembers.id, id))) as any[])[0]
const logRows = async (timeEntryId: string) => (await t.db.select().from(t.schema.familyVisitText).where(eq(t.schema.familyVisitText.timeEntryId, timeEntryId))) as any[]
const NOON = new Date('2026-12-02T17:00:00Z') // 11:00 AM Central
const entry = async (over: any = {}) => ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.pat, startTime: new Date('2026-12-02T15:00:00Z'), endTime: new Date('2026-12-02T17:00:00Z'), isComplete: true, durationMinutes: 120, allottedMinutes: 120, ...over })
const mk = async (name: string, over: any = {}) => {
  const email = `${name.toLowerCase()}@family.example`
  const r = await json(as('owner')('/api/family-portal/admin/members', { method: 'POST', json: { clientId: ids.pat, password: 'Family-pass-1', name, email, ...over } }))
  expect(r.status).toBe(201)
  ids[name.toLowerCase()] = r.body.id
  tokens[name.toLowerCase()] = (await json(t.call('/api/family-portal/login', { method: 'POST', json: { email, password: 'Family-pass-1' } }))).body.token
  return r
}
const subscribe = (who: string, endpoint: string) => fam(who)('/portal/push-subscription', { method: 'POST', json: { subscription: { endpoint, keys: { p256dh: 'x', auth: 'y' } } } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', name: 'Test Care' } as any).where(eq(t.schema.company.id, companyId))
  await t.db.update(t.schema.user).set({ phone: '608-555-0199' } as any).where(eq(t.schema.user.id, ids.owner))
  tokens.owner = await login('owner@test.example', seeded.password)
  core = createHomecareCore({ services: t.services.crm } as any)
  core.notify._setSmsSender(async (to: string, body: string) => { texts.push({ to, body }); return { status: 'sent', sid: 'SM1', error: null } })
  core.notify._setFamilyPushSender(async (_sub: unknown, payload: any) => { pushes.push({ payload }); return 'sent' })
  core.notify._setPushSender(async (userId: string, payload: any) => { staffPushes.push({ userId, payload }); return 1 })
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { emails.push(m); return { success: true } }
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  await setFeatures(ON)
  await mk('Mary', { phone: '608-555-0111', visitTextOptIn: true, visitEmailOptIn: true })
  await mk('Joe', { phone: '608-555-0122', visitTextOptIn: true })
  await mk('Nia', { phone: '608-555-0133' }) // no yes to anything
}, 90_000)

beforeEach(() => { texts.length = 0; emails.length = 0; pushes.length = 0; staffPushes.length = 0 })

describe('a rule is read in plain words (pure)', () => {
  test('each missing or wrong part names its box', () => {
    const read = (b: any) => { const r = readRule(b, wordingProblem); return 'problem' in r ? r.field : 'ok' }
    expect(read({ trigger: 'clock_in', audience: 'office', channels: ['push'] })).toBe('name')
    expect(read({ name: 'x', trigger: 'sometime', audience: 'office', channels: ['push'] })).toBe('trigger')
    expect(read({ name: 'x', trigger: 'clock_in', audience: 'everyone', channels: ['push'] })).toBe('audience')
    expect(read({ name: 'x', trigger: 'late_clock_in', audience: 'office', channels: ['push'] })).toBe('minutes')
    expect(read({ name: 'x', trigger: 'clock_in', audience: 'office', channels: [] })).toBe('channels')
    expect(read({ name: 'x', trigger: 'clock_in', audience: 'caregiver', channels: ['email'] })).toBe('channels')
    expect(read({ name: 'x', trigger: 'clock_in', audience: 'office', channels: ['push'], message: 'Hi {nurse}' })).toBe('message')
    expect(read({ name: 'x', trigger: 'clock_in', audience: 'office', channels: ['push'], message: 'Hi {minutes}' })).toBe('message')
    expect(read({ name: 'x', trigger: 'late_clock_in', minutes: 10, audience: 'relatives', channels: ['sms', 'push'], message: '{caregiver} is {minutes} late' })).toBe('ok')
  })
})

describe('the email yes keeps its exact words', () => {
  test('stored when the office records the yes (on add and on edit), kept while it stays on, cleared when taken back', async () => {
    expect((await member(ids.mary)).visitEmailConsentWording).toBe(emailConsentWording('Test Care'))
    expect((await member(ids.joe)).visitEmailConsentWording).toBeNull()
    const on = await json(as('owner')(`/api/family-portal/admin/members/${ids.joe}`, { method: 'PUT', json: { visitEmailOptIn: true } }))
    expect(on.body.visitEmailConsentWording).toBe(emailConsentWording('Test Care'))
    const at = on.body.visitEmailOptInAt
    const same = await json(as('owner')(`/api/family-portal/admin/members/${ids.joe}`, { method: 'PUT', json: { visitEmailOptIn: true, relationship: 'child' } }))
    expect(same.body.visitEmailOptInAt).toBe(at) // a yes already on keeps its date
    const off = await json(as('owner')(`/api/family-portal/admin/members/${ids.joe}`, { method: 'PUT', json: { visitEmailOptIn: false } }))
    expect([off.body.visitEmailOptIn, off.body.visitEmailOptInAt, off.body.visitEmailConsentWording]).toEqual([false, null, null])
  })
})

describe('app notices on the relative\'s own phone or browser', () => {
  test('a relative turns it on; the next arrival reaches that device, and nobody else\'s; a replayed punch never pushes twice', async () => {
    expect((await json(subscribe('joe', 'ftp://nope'))).status).toBe(400)
    expect((await subscribe('joe', 'https://push.example/joe')).status).toBe(200)
    expect((await json(fam('joe')('/portal/notices'))).body).toMatchObject({ textOptIn: true, emailOptIn: false, pushDevices: 1 })
    const e = await entry()
    expect(await core.familyTexts.onClockEvent(companyId, e, 'clock_in', NOON, NOON)).toBe(4) // Mary: text + email; Joe: text + push
    expect(pushes).toHaveLength(1)
    expect(pushes[0].payload).toMatchObject({ title: 'Test Care', body: 'Ann has arrived to help Pat (11:00 AM).' })
    expect((await logRows(e.id)).map((r) => `${r.familyMemberId === ids.joe ? 'joe' : 'mary'}:${r.channel}:${r.status}`).sort()).toEqual(['joe:push:sent', 'joe:sms:sent', 'mary:email:sent', 'mary:sms:sent'])
    expect(await core.familyTexts.onClockEvent(companyId, e, 'clock_in', NOON, NOON)).toBe(0)
    expect(pushes).toHaveLength(1)
  })
  test('held in quiet hours and for a late punch, like a text, and the office screen says why', async () => {
    const night = new Date('2026-12-04T03:30:00Z') // 9:30 PM Central
    const e = await entry()
    expect(await core.familyTexts.onClockEvent(companyId, e, 'clock_in', night, night)).toBe(1) // Mary's email only
    expect((await logRows(e.id)).map((r) => `${r.channel}:${r.status}`).sort()).toEqual(['email:sent', 'push:skipped_quiet', 'sms:skipped_quiet', 'sms:skipped_quiet'])
    const log = (await json(office('/texts?status=skipped_quiet'))).body.data as any[]
    const mine = log.find((r) => r.timeEntryId === e.id && r.channel === 'push')
    expect(mine).toMatchObject({ channelLabel: 'App notice', statusLabel: 'Held (quiet hours)', relativeName: 'Joe' })
    expect(mine.reason).toContain('quiet hours')
  })
  test('a device that is gone is dropped and shows as failed; the relative can turn it off; the feature off hides it all', async () => {
    core.notify._setFamilyPushSender(async () => 'gone')
    const e = await entry()
    await core.familyTexts.onClockEvent(companyId, e, 'clock_in', NOON, NOON)
    expect((await logRows(e.id)).find((r) => r.channel === 'push')).toMatchObject({ status: 'failed', reason: 'No phone or browser of theirs could be reached.' })
    expect((await json(fam('joe')('/portal/notices'))).body.pushDevices).toBe(0)
    core.notify._setFamilyPushSender(async (_s: unknown, payload: any) => { pushes.push({ payload }); return 'sent' })
    await subscribe('joe', 'https://push.example/joe2')
    expect((await json(fam('joe')('/portal/notices'))).body.pushDevices).toBe(1)
    expect((await fam('joe')('/portal/push-subscription/off', { method: 'POST' })).status).toBe(200)
    expect((await json(fam('joe')('/portal/notices'))).body.pushDevices).toBe(0)
    await subscribe('joe', 'https://push.example/joe3')
    await setFeatures(['contacts', 'scheduling', 'team', 'care_family_texts'])
    expect((await fam('joe')('/portal/notices')).status).toBe(404)
    expect((await subscribe('joe', 'https://push.example/joe4')).status).toBe(404)
    const e2 = await entry()
    expect(await core.familyTexts.onClockEvent(companyId, e2, 'clock_in', NOON, NOON)).toBe(2) // the two texts only
    expect(pushes).toHaveLength(0)
    await setFeatures(ON)
    await fam('joe')('/portal/push-subscription/off', { method: 'POST' })
  })
})

describe('the agency\'s alert rules', () => {
  const rule = (b: any) => office('/alert-rules', { method: 'POST', json: b })
  beforeEach(async () => { await t.db.delete(t.schema.familyAlertRule) })

  test('the office writes a rule; a bad one names its box; a caregiver cannot', async () => {
    const bad = await json(rule({ name: 'x', trigger: 'clock_in', audience: 'caregiver', channels: ['email'] }))
    expect([bad.status, bad.body.code, Object.keys(bad.body.fields)]).toEqual([400, 'bad_rule', ['channels']])
    const opts = (await json(office('/alert-rules/options'))).body
    expect(opts.triggers.map((x: any) => x.id)).toEqual(['clock_in', 'clock_out', 'late_clock_in'])
    expect(opts.audiences.find((a: any) => a.id === 'caregiver').channels).toEqual(['sms', 'push'])
    expect((await as('ann')('/api/family-comms/alert-rules', { method: 'POST', json: { name: 'x', trigger: 'clock_in', audience: 'office', channels: ['push'] } })).status).toBe(403)
    const made = await json(rule({ name: 'Tell me', trigger: 'clock_in', audience: 'office', channels: ['push'] }))
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ triggerLabel: 'The caregiver arrives', audienceLabel: 'The office', isActive: true })
  })

  test('an office rule: every admin gets the in-app notice, the text and the push it asks for, once per visit', async () => {
    await rule({ name: 'Office arrival', trigger: 'clock_in', audience: 'office', channels: ['sms', 'push'], message: '{caregiver} is at {client} ({time}).' })
    const notes = async () => (await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.userId, ids.owner))) as any[]
    const before = (await notes()).length
    const e = await entry()
    await core.familyTexts.onClockEvent(companyId, e, 'clock_in', NOON, NOON)
    const mine = await notes()
    expect(mine.length).toBe(before + 1)
    expect(mine.at(-1)).toMatchObject({ title: 'Office arrival', message: 'Ann is at Pat (11:00 AM).' })
    expect(texts.filter((x) => x.to === '+16085550199').map((x) => x.body)).toEqual(['Ann is at Pat (11:00 AM).'])
    expect(staffPushes.filter((p) => p.userId === ids.owner)).toHaveLength(1)
    await core.familyTexts.onClockEvent(companyId, e, 'clock_in', NOON, NOON)
    expect((await notes()).length).toBe(before + 1)
    expect(texts.filter((x) => x.to === '+16085550199')).toHaveLength(1)
    const log = (await t.db.select().from(t.schema.alertRuleLog).where(eq(t.schema.alertRuleLog.timeEntryId, e.id))) as any[]
    expect(log.map((l) => `${l.channel}:${l.status}`).sort()).toEqual(['app:sent', 'push:sent', 'sms:sent'])
  })

  test('a rule for relatives reaches only the channels each agreed to, in the agency\'s words, on top of the standard notice', async () => {
    await rule({ name: 'Finish by email and app', trigger: 'clock_out', audience: 'relatives', channels: ['email', 'push'], message: 'Visit over for {client}. {caregiver} left at {time}.' })
    await subscribe('joe', 'https://push.example/joe5')
    const e = await entry()
    await core.familyTexts.onClockEvent(companyId, e, 'clock_out', NOON, NOON)
    // Mary (email yes): the standard email AND the rule's; Joe (push): the standard push AND the rule's; Nia: nothing
    expect(emails.map((m) => m.to)).toEqual(['mary@family.example', 'mary@family.example'])
    expect(emails.some((m) => m.subject === 'Test Care: Finish by email and app' && m.html.includes('Visit over for Pat. Ann left at 11:00 AM.'))).toBe(true)
    expect(pushes.map((p) => p.payload.body).sort()).toEqual(['Ann has finished the visit with Pat (11:00 AM).', 'Visit over for Pat. Ann left at 11:00 AM.'])
    const rows = await logRows(e.id)
    expect(rows.filter((r) => r.ruleId !== '').map((r) => r.channel).sort()).toEqual(['email', 'push'])
    const screen = (await json(office('/texts'))).body.data as any[]
    expect(screen.find((r) => r.timeEntryId === e.id && r.ruleId !== '' && r.channel === 'email').ruleName).toBe('Finish by email and app')
    await fam('joe')('/portal/push-subscription/off', { method: 'POST' })
  })

  test('a late-arrival rule fires only when the caregiver is later than its minutes, from the schedule on the agency\'s clock; the caregiver\'s own rule goes through their settings', async () => {
    const sched = await ins(t.schema.schedules, { companyId, clientId: ids.pat, caregiverId: ids.ann, startTime: new Date('2026-12-02T09:00:00Z'), endTime: new Date('2026-12-02T11:00:00Z'), scheduleType: 'recurring', dayOfWeek: 3, isActive: true })
    await rule({ name: 'Late', trigger: 'late_clock_in', minutes: 15, audience: 'office', channels: ['push'], message: '{caregiver} is {minutes} minutes late to {client}.' })
    await rule({ name: 'Caregiver nudge', trigger: 'late_clock_in', minutes: 5, audience: 'caregiver', channels: ['push'] })
    const tenLate = new Date('2026-12-02T15:10:00Z') // 9:10 AM Central
    const e1 = await entry({ scheduleId: sched.id, startTime: tenLate })
    await core.familyTexts.onClockEvent(companyId, e1, 'clock_in', tenLate, tenLate)
    expect(staffPushes.map((p) => p.userId)).toEqual([ids.ann]) // only the 5-minute rule
    staffPushes.length = 0
    const twentyLate = new Date('2026-12-03T15:20:00Z')
    const e2 = await entry({ scheduleId: sched.id, startTime: twentyLate })
    await core.familyTexts.onClockEvent(companyId, e2, 'clock_in', twentyLate, twentyLate)
    expect(staffPushes.map((p) => p.userId).sort()).toEqual([ids.owner, ids.ann].sort())
    const note = ((await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.userId, ids.owner))) as any[]).find((n) => n.title === 'Late')
    expect(note?.message).toBe('Ann is 20 minutes late to Pat.')
    staffPushes.length = 0
    const e3 = await entry() // no schedule: never "late"
    await core.familyTexts.onClockEvent(companyId, e3, 'clock_in', twentyLate, twentyLate)
    expect(staffPushes).toHaveLength(0)
  })

  test('edit, switch off and remove a rule; an off rule does nothing', async () => {
    const made = (await json(rule({ name: 'Edit me', trigger: 'clock_in', audience: 'office', channels: ['push'] }))).body
    const off = await json(office(`/alert-rules/${made.id}`, { method: 'PUT', json: { isActive: false } }))
    expect(off.body).toMatchObject({ isActive: false, name: 'Edit me', channels: ['push'] })
    const e = await entry()
    await core.familyTexts.onClockEvent(companyId, e, 'clock_in', NOON, NOON)
    expect(staffPushes).toHaveLength(0)
    expect((await json(office(`/alert-rules/${made.id}`, { method: 'PUT', json: { audience: 'caregiver', channels: ['email'] } }))).status).toBe(400)
    expect((await json(office('/alert-rules'))).body.data).toHaveLength(1)
    expect((await office(`/alert-rules/${made.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await office(`/alert-rules/${made.id}`, { method: 'DELETE' })).status).toBe(404)
    await setFeatures(['contacts', 'scheduling', 'team', 'care_family_texts'])
    expect((await office('/alert-rules')).status).toBe(403) // the whole /api/family-comms mount is behind the feature
    await setFeatures(ON)
  })
})
