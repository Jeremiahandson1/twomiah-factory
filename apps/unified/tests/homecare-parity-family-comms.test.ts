// Home care parity row 7 (docs/parity/homecare-family-text.md): a relative asks the office for a visit change / service change / new visit (an
// office task and an Open requests count), the exact consent wording kept with the yes, a relative's STOP honoured by our own record, a log of
// every family text sent or held and why, the agency's own wording for the texts, and the four portal emails in the agency's words. Behind
// care_family_comms (with care_family_texts for the texts).
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { wordingProblem, fill, consentWording } from '../server/crm/homecare/core/familyComms.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const texts: any[] = []
const emails: any[] = []
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (p: Response | Promise<Response>) => { const r = await p; return { status: r.status, body: await r.json() as any } }
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const ON = ['contacts', 'scheduling', 'team', 'care_family_texts', 'care_family_comms']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const famCall = (who: string, p: string, init: any = {}) => t.call(`/api/family-portal${p}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const addMember = (b: any) => json(as("owner")("/api/family-portal/admin/members", { method: "POST", json: { clientId: ids.pat, password: "Family-pass-1", ...b } }))
const famLogin = async (email: string, password = 'Family-pass-1') => (await json(await t.call('/api/family-portal/login', { method: 'POST', json: { email, password } }))).body
// closed visits: a caregiver may hold only one open one, and the text rules need only the punch time
const visit = async (start: string) => ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.pat, startTime: new Date(start), endTime: new Date(+new Date(start) + 60_000), isComplete: true })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { texts.push(m); return { status: 'sent' } }
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { emails.push(m); return { ok: true } }
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', name: 'Test Care', integrations: { twilioMessagingServiceSid: 'MG' + 'a'.repeat(32), twilioPhoneNumber: '+17155550123' } } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  core = createHomecareCore({ services: t.services.crm } as any)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  await setFeatures(ON)
  const mary = await addMember({ name: 'Mary Client', email: 'mary@family.example', phone: '608-555-0111', visitTextOptIn: true, visitEmailOptIn: true })
  expect(mary.status).toBe(201)
  ids.mary = mary.body.id
  const joe = await addMember({ name: 'Joe Client', email: 'joe@family.example', phone: '608-555-0122', visitTextOptIn: true })
  ids.joe = joe.body.id
  const nia = await addMember({ name: 'Nia Client', email: 'nia@family.example', canMessage: false })
  ids.nia = nia.body.id
  tokens.mary = (await famLogin('mary@family.example')).token
  tokens.nia = (await famLogin('nia@family.example')).token
}, 90_000)

describe('wording is checked before it can reach a family (pure)', () => {
  test('an unknown tag, an empty text, an open bracket and a long text are each refused in plain words', () => {
    expect(wordingProblem('{caregiver} arrived', ['caregiver', 'client'], 300, 'the arrival text')).toBeNull()
    expect(wordingProblem('{caregvier} arrived', ['caregiver', 'client'], 300, 'the arrival text')).toContain('{caregvier} is not something we can fill in')
    expect(wordingProblem('   ', ['caregiver'], 300, 'the arrival text')).toBe('Write the words for the arrival text.')
    expect(wordingProblem('hello {caregiver', ['caregiver'], 300, 'the arrival text')).toContain('curly bracket')
    expect(wordingProblem('x'.repeat(301), ['caregiver'], 300, 'the arrival text')).toContain('too long')
    expect(fill('{caregiver} at {time}', { caregiver: 'Ann', time: '9:00 AM' })).toBe('Ann at 9:00 AM')
  })
})

describe('a relative asks the office', () => {
  const ask = (who: string, b: any) => famCall(who, '/portal/requests', { method: 'POST', json: b })
  test('it becomes an office task and counts on the Open requests tile; saying the same again is not a second request', async () => {
    const r = await json(await ask('mary', { kind: 'visit_change', visitDate: '2026-11-10', details: 'Can the Tuesday visit start an hour later?' }))
    expect(r.status).toBe(201)
    const again = await json(await ask('mary', { kind: 'visit_change', visitDate: '2026-11-10', details: 'Can the Tuesday visit start an hour later?' }))
    expect(again.body.id).toBe(r.body.id)
    const tasks = (await t.db.select().from(t.schema.task).where(eq(t.schema.task.companyId, companyId))) as any[]
    expect(tasks.filter((x) => x.title.startsWith('Family request:'))).toHaveLength(1)
    expect(tasks[0].description).toContain('Tuesday visit')
    expect((await json(await as('owner')('/api/family-comms/summary'))).body.openRequests).toBe(1)
    const notes = (await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.companyId, companyId))) as any[]
    expect(notes.some((n) => n.type === 'family_request')).toBe(true)
    ids.req = r.body.id
  })
  test('it says what is wrong in plain words and refuses a relative who may not message', async () => {
    expect((await json(await ask('mary', { kind: 'refund', details: 'x' }))).body.code ?? '').toBe('bad_kind')
    expect((await json(await ask('mary', { kind: 'new_visit', details: '   ' }))).status).toBe(400)
    expect((await json(await ask('mary', { kind: 'new_visit', visitDate: 'tomorrow', details: 'x' }))).status).toBe(400)
    expect((await ask('nia', { kind: 'new_visit', details: 'x' })).status).toBe(403)
  })
  test('the relative sees their own requests with their state; the office deals with one and its task is closed', async () => {
    const mine = (await json(await famCall('mary', '/portal/requests'))).body.data
    expect(mine.map((x: any) => [x.kindLabel, x.statusLabel])).toEqual([['Change a visit', 'Open']])
    const done = await json(await as('owner')(`/api/family-comms/requests/${ids.req}`, { method: 'PUT', json: { status: 'done', note: 'Moved to 10 AM.' } }))
    expect(done.status).toBe(200)
    expect(done.body.openRequests).toBe(0)
    expect((await json(await as('owner')(`/api/family-comms/requests/${ids.req}`, { method: 'PUT', json: { status: 'declined' } }))).status).toBe(409)
    expect((await json(await famCall('mary', '/portal/requests'))).body.data[0]).toMatchObject({ statusLabel: 'Done', handledNote: 'Moved to 10 AM.' })
    const task = ((await t.db.select().from(t.schema.task).where(eq(t.schema.task.companyId, companyId))) as any[])[0]
    expect(task.status).toBe('completed')
    expect((await as('ann')(`/api/family-comms/requests/${ids.req}`, { method: 'PUT', json: { status: 'done' } })).status).toBe(403)
  })
  test('with the feature off the routes do not exist', async () => {
    await setFeatures(['contacts', 'scheduling', 'team', 'care_family_texts'])
    expect((await ask('mary', { kind: 'new_visit', details: 'x' })).status).toBe(404)
    expect((await as('owner')('/api/family-comms/summary')).status).toBe(403)
    await setFeatures(ON)
  })
})

describe('the yes keeps its exact words, and STOP is honoured by our own record', () => {
  test('the words the relative agreed to are stored with the yes, and cleared when the yes is withdrawn', async () => {
    const row = async (id: string) => ((await t.db.select().from(t.schema.familyMembers).where(eq(t.schema.familyMembers.id, id))) as any[])[0]
    expect((await row(ids.mary)).visitTextConsentWording).toBe(consentWording('Test Care'))
    expect((await row(ids.mary)).visitTextConsentWording).toContain('Reply STOP')
    const off = await json(await as('owner')(`/api/family-portal/admin/members/${ids.joe}`, { method: 'PUT', json: { visitTextOptIn: false } }))
    expect(off.status).toBe(200)
    expect((await row(ids.joe)).visitTextConsentWording).toBeNull()
    await as('owner')(`/api/family-portal/admin/members/${ids.joe}`, { method: 'PUT', json: { visitTextOptIn: true } })
    expect((await row(ids.joe)).visitTextConsentWording).toBe(consentWording('Test Care'))
  })

  test('a relative who texts STOP is switched off by us, others are not, and no text is tried for them at the next visit', async () => {
    const sms = t.services.crm.sms as any
    expect(sms.handleIncomingSMS).toBeDefined()
    await sms.handleIncomingSMS({ From: '+16085550111', To: '+17155550123', Body: ' stop ', MessageSid: 'SMSTOP1' })
    const mary = ((await t.db.select().from(t.schema.familyMembers).where(eq(t.schema.familyMembers.id, ids.mary))) as any[])[0]
    const joe = ((await t.db.select().from(t.schema.familyMembers).where(eq(t.schema.familyMembers.id, ids.joe))) as any[])[0]
    expect(mary.visitTextOptIn).toBe(false)
    expect(mary.visitTextOptOutAt).toBeTruthy()
    expect(joe.visitTextOptIn).toBe(true)
    texts.length = 0
    const v = await visit(new Date(Date.now() - 60_000).toISOString())
    await core.familyTexts.onClockEvent(companyId, v, 'clock_in', new Date(Date.now() - 60_000), new Date())
    expect(texts.map((m) => m.toPhone)).toEqual(['+16085550122'])
    // START does not quietly turn a relative's texts back on: the office records a new yes.
    await sms.handleIncomingSMS({ From: '+16085550111', To: '+17155550123', Body: 'START', MessageSid: 'SMSTOP2' })
    expect((((await t.db.select().from(t.schema.familyMembers).where(eq(t.schema.familyMembers.id, ids.mary))) as any[])[0]).visitTextOptIn).toBe(false)
    // the office records a new yes: the optout is cleared and the words are kept again
    await as('owner')(`/api/family-portal/admin/members/${ids.mary}`, { method: 'PUT', json: { visitTextOptIn: true } })
    const again = ((await t.db.select().from(t.schema.familyMembers).where(eq(t.schema.familyMembers.id, ids.mary))) as any[])[0]
    expect(again.visitTextOptIn).toBe(true)
    expect(again.visitTextOptOutAt).toBeNull()
  })
})

describe('what went to relatives, and why not when not', () => {
  test('the screen lists each text and email with who, which visit and the reason it was held or failed', async () => {
    texts.length = 0; emails.length = 0
    const v = await visit(new Date(Date.now() - 3600_000).toISOString())
    // an arrival that reaches us over 30 minutes late is held for every relative; a fresh finish goes out
    await core.familyTexts.onClockEvent(companyId, v, 'clock_in', new Date(Date.now() - 2 * 3600_000), new Date())
    await core.familyTexts.onClockEvent(companyId, v, 'clock_out', new Date(), new Date(Date.now() + 1000))
    const log = (await json(await as('owner')('/api/family-comms/texts'))).body.data as any[]
    const mine = log.filter((r) => r.timeEntryId === v.id)
    expect(mine.length).toBeGreaterThanOrEqual(4)
    const held = mine.filter((r) => r.event === 'clock_in')
    expect(held.every((r) => r.status === 'skipped_late' && r.statusLabel === 'Held (too late to be news)' && /more than 30 minutes/.test(r.reason))).toBe(true)
    const sentRows = mine.filter((r) => r.event === 'clock_out')
    expect(sentRows.some((r) => r.status === 'sent' && r.channel === 'sms' && r.relativeName === 'Joe Client')).toBe(true)
    expect(sentRows.some((r) => r.status === 'sent' && r.channelLabel === 'Email' && r.relativeName === 'Mary Client')).toBe(true)
    const onlyHeld = (await json(await as('owner')('/api/family-comms/texts?status=skipped_late'))).body.data as any[]
    expect(onlyHeld.every((r) => r.status === 'skipped_late')).toBe(true)
    expect((await json(await as('owner')('/api/family-comms/texts?status=weird'))).status).toBe(400)
    expect((await json(await as('owner')('/api/family-comms/texts?from=2026-01-01&to=2026-12-31'))).body.code).toBe('range_too_long')
    expect(emails.some((m) => /has finished the visit/.test(m.subject) && m.to === 'mary@family.example')).toBe(true)
    expect((await as('ann')('/api/family-comms/texts')).status).toBe(403)
  })
})

describe('the agency\'s own wording', () => {
  test('a typo in a tag is refused; saved wording is what the family gets, with the STOP line kept', async () => {
    const bad = await json(await as('owner')('/api/family-comms/text-wording', { method: 'PUT', json: { arrivalText: '{caregvier} is here', departureText: '{caregiver} left {client}' } }))
    expect(bad.status).toBe(400)
    expect(bad.body.fields?.arrivalText ?? bad.body.error).toContain('{caregvier}')
    const ok = await json(await as('owner')('/api/family-comms/text-wording', { method: 'PUT', json: { arrivalText: 'Good news from {agency}: {caregiver} is with {client} as of {time}.', departureText: '{caregiver} has left {client} ({time}).' } }))
    expect(ok.status).toBe(200)
    texts.length = 0
    const v = await visit(new Date(Date.now() - 30_000).toISOString())
    await core.familyTexts.onClockEvent(companyId, v, 'clock_in', new Date(Date.now() - 30_000), new Date())
    expect(texts.length).toBeGreaterThan(0)
    expect(texts[0].message).toMatch(/^Good news from Test Care: Ann is with Pat as of /)
    expect(texts[0].message).toContain('Reply STOP to stop these texts.')
    expect(texts[0].message.startsWith('Test Care: Good news')).toBe(false) // the agency tag is used, so no second prefix
  })
})

describe('the four portal emails, in the agency\'s words', () => {
  beforeEach(() => { emails.length = 0 })
  test('account created uses the agency\'s wording; the two switchable ones can be switched off, the account\'s own mail cannot', async () => {
    const put = (kind: string, b: any) => as('owner')(`/api/family-comms/email-templates/${kind}`, { method: 'PUT', json: b })
    expect((await put('accountCreated', { subject: 'Hi from {agency}', body: 'Dear {name}, sign in at {loginUrl} with {email} and {tempPassword}.' })).status).toBe(200)
    expect((await json(await put('accountCreated', { subject: 'Hi', body: 'Dear {nmae}' }))).status).toBe(400)
    const off = await json(await put('accountCreated', { subject: 'Hi', body: 'Dear {name}', enabled: false }))
    expect(off.status).toBe(400)
    expect(off.body.error).toContain('always goes')
    const made = await addMember({ name: 'Sam Client', email: 'sam@family.example' })
    expect(made.status).toBe(201)
    ids.sam = made.body.id
    const mail = emails.find((m) => m.to === 'sam@family.example')
    expect(mail.subject).toBe('Hi from Test Care')
    expect(mail.html).toContain('Dear Sam Client, sign in at')
    expect(mail.html).toContain('Family-pass-1')
    // revoke and grant: sent in the agency's words; switch revoke off and nothing goes
    emails.length = 0
    expect((await as('owner')(`/api/family-portal/admin/members/${ids.sam}/status`, { method: 'PUT', json: { isActive: false } })).status).toBe(200)
    expect(emails.map((m) => m.subject)).toEqual(['Your Test Care family portal access has been turned off'])
    emails.length = 0
    const rev = (await json(await as('owner')('/api/family-comms/email-templates'))).body.data.find((x: any) => x.kind === 'accessRevoked')
    expect((await put('accessRevoked', { subject: rev.subject, body: rev.body, enabled: false })).status).toBe(200)
    await as('owner')(`/api/family-portal/admin/members/${ids.sam}/status`, { method: 'PUT', json: { isActive: true } })
    expect(emails.map((m) => m.subject)).toEqual(['Your Test Care family portal access is back on'])
    emails.length = 0
    await as('owner')(`/api/family-portal/admin/members/${ids.sam}/status`, { method: 'PUT', json: { isActive: false } })
    expect(emails).toHaveLength(0) // revoked is switched off
    expect((await as('owner')('/api/family-comms/email-templates/accessRevoked', { method: 'DELETE' })).status).toBe(200)
  })

  test('forgot password: a link that works once, the same answer for an unknown address, and nothing without the feature', async () => {
    const forgot = (email: string) => json(t.call('/api/family-portal/forgot-password', { method: 'POST', json: { email } }))
    expect((await json(t.call('/api/family-portal/options'))).body.forgotPassword).toBe(true)
    const known = await forgot('joe@family.example')
    const unknown = await forgot('nobody@family.example')
    expect(known.status).toBe(200)
    expect(unknown.body).toEqual(known.body)
    expect(emails.filter((m) => m.to === 'nobody@family.example')).toHaveLength(0)
    const mail = emails.find((m) => m.to === 'joe@family.example')
    const token = /reset=([\w.-]+)/.exec(mail.html)![1]
    expect((await json(t.call('/api/family-portal/reset-password', { method: 'POST', json: { token, password: 'short' } }))).status).toBe(400)
    expect((await json(t.call('/api/family-portal/reset-password', { method: 'POST', json: { token, password: 'Brand-new-pass-9' } }))).status).toBe(200)
    expect((await famLogin('joe@family.example', 'Brand-new-pass-9')).token).toBeTruthy()
    const reuse = await json(t.call('/api/family-portal/reset-password', { method: 'POST', json: { token, password: 'Another-pass-99' } }))
    expect(reuse.status).toBe(400)
    expect(reuse.body.code).toBe('bad_reset_link')
    expect((await json(t.call('/api/family-portal/reset-password', { method: 'POST', json: { token: 'not.a.token', password: 'Another-pass-99' } }))).body.code).toBe('bad_reset_link')
    await setFeatures(['contacts', 'scheduling', 'team', 'care_family_texts'])
    emails.length = 0
    await forgot('joe@family.example')
    expect(emails).toHaveLength(0)
    expect((await json(t.call('/api/family-portal/options'))).body.forgotPassword).toBe(false)
    await setFeatures(ON)
  })
})
