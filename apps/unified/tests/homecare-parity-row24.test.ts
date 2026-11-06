// Home care parity row 24 (docs/parity/homecare-supervisory-visits.md), on top of item 11 (homecare-depth-supervisory.test.ts):
//   · a service code can carry its own cycle (the shortest among a client's codes authorised today), below the client's own days;
//   · the office plans a visit on the calendar for a named supervisor; only a DONE visit restarts the clock;
//   · the supervisor gets it on their phone (and no one else does), starts it, fills in the form plus the agency's own questions,
//     signs, and the client signs or the supervisor says why not; the agency can require both signatures;
//   · the supervisor is reminded once in the 24 hours before; a moved visit is reminded again;
//   · the office can move, hand over or cancel a planned visit. All behind care_supervisory_visits.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { checkQuestions, checkVisitForm } from '../server/crm/homecare/core/supervisory.ts'
import { ymdIn, hmsIn } from '../server/crm/homecare/core/agencyTime.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const texts: any[] = []
const emails: any[] = []
const TZ = 'America/Chicago'
const SIG = 'data:image/png;base64,iVBORw0KGgo='
const day = (offset: number) => ymdIn(new Date(Date.now() + offset * 86_400_000), TZ)
/** The agency's day and HH:MM `hours` from now. */
const at = (hours: number) => { const x = new Date(Date.now() + hours * 3600_000); return { date: ymdIn(x, TZ), time: hmsIn(x, TZ).slice(0, 5) } }
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (p: Response | Promise<Response>) => { const r = await p; return { status: r.status, body: await r.json() as any } }
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BASE = ['contacts', 'scheduling', 'team', 'dashboard']
const ON = [...BASE, 'care_supervisory_visits']
const owner = () => as('owner')
const list = async () => (await json(owner()('/api/supervisory-visits'))).body
const row = (b: any, id: string) => b.clients.find((c: any) => c.clientId === id)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { texts.push(m); return { status: 'sent' } }
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { emails.push(m); return { ok: true } }
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: TZ, name: 'Test Care' } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  core = createHomecareCore({ services: t.services.crm } as any)
  const hash = await Bun.password.hash('Staff-pass-1', 'bcrypt')
  // the nurse who does supervisory visits is a field seat with a phone; Ann is a caregiver who is not named on any visit
  ids.nina = (await ins(t.schema.user, { email: 'nina@test.example', passwordHash: hash, firstName: 'Nina', lastName: 'Nurse', role: 'caregiver', phone: '608-555-0177', companyId })).id
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.nina = await login('nina@test.example', 'Staff-pass-1')
  tokens.ann = await login('ann@test.example', 'Staff-pass-1')
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, startDate: day(-20), address: '1 Elm St', city: 'Eau Claire' })).id
  ids.cody = (await ins(t.schema.clients, { companyId, firstName: 'Cody', lastName: 'Coded', isActive: true, startDate: day(-20) })).id
  // Cody is authorised today for a code whose cycle is 14 days; an expired authorisation for a 7-day code does not count
  await ins(t.schema.serviceCodes, { companyId, code: 'T1019', description: 'Personal care', supervisoryIntervalDays: 14 })
  await ins(t.schema.serviceCodes, { companyId, code: 'S5130', description: 'Homemaker', supervisoryIntervalDays: 7 })
  await ins(t.schema.authorizations, { companyId, clientId: ids.cody, procedureCode: 'T1019', authorizedUnits: '100', startDate: day(-30), endDate: day(30), status: 'active' })
  await ins(t.schema.authorizations, { companyId, clientId: ids.cody, procedureCode: 'S5130', authorizedUnits: '100', startDate: day(-90), endDate: day(-31), status: 'active' })
  await setFeatures(ON)
}, 90_000)

describe('the form rules (pure)', () => {
  test('questions need words and a kind; ids are made from the words and kept unique', () => {
    expect(checkQuestions([{ label: '  ' , kind: 'text' }])).toEqual({ problem: 'Question 1 has no words.' })
    expect('problem' in checkQuestions([{ label: 'Smoke alarm works?', kind: 'maybe' }])).toBe(true)
    expect('problem' in checkQuestions(new Array(21).fill({ label: 'x', kind: 'text' }))).toBe(true)
    const ok = checkQuestions([{ label: 'Smoke alarm works?', kind: 'yes_no', required: true }, { label: 'Smoke alarm works?', kind: 'text' }]) as any
    expect(ok.questions.map((q: any) => q.id)).toEqual(['smoke_alarm_works', 'smoke_alarm_works_2'])
    expect(ok.questions[0].required).toBe(true)
  })
  test('a required question must be answered; a phone visit needs no client signature; required signatures are asked for', () => {
    const qs = [{ id: 'alarm', label: 'Smoke alarm works?', kind: 'yes_no' as const, required: true }]
    expect((checkVisitForm({ concerns: 'x' }, { questions: qs, requireSignatures: false }) as any).code).toBe('answer_required')
    const phone = checkVisitForm({ visitType: 'phone', answers: { alarm: 'yes' } }, { questions: qs, requireSignatures: false }) as any
    expect(phone.value).toMatchObject({ clientSignReason: 'Visit by phone', answers: [{ id: 'alarm', answer: true }] })
    expect((checkVisitForm({ concerns: 'x' }, { questions: [], requireSignatures: true }) as any).field).toBe('supervisorSignature')
    expect((checkVisitForm({ concerns: 'x', supervisorSignature: SIG }, { questions: [], requireSignatures: true }) as any).field).toBe('clientSignature')
    expect((checkVisitForm({ concerns: 'x', supervisorSignature: 'not an image' }, { questions: [], requireSignatures: false }) as any).code).toBe('bad_signature')
    expect('value' in checkVisitForm({ concerns: 'x', supervisorSignature: SIG, clientSignReason: 'Asleep' }, { questions: [], requireSignatures: true })).toBe(true)
  })
})

describe('the cycle: client, then service code, then agency', () => {
  test('a client authorised for a code with its own days is due on that code\'s cycle; their own days beat it', async () => {
    let b = await list()
    expect(row(b, ids.cody)).toMatchObject({ intervalDays: 14, intervalSource: 'service_code', status: 'overdue', daysOverdue: 6 })
    expect(row(b, ids.pat)).toMatchObject({ intervalDays: 90, intervalSource: 'agency', status: 'ok' })
    await owner()(`/api/supervisory-visits/client/${ids.cody}/interval`, { method: 'PUT', json: { days: 30 } })
    b = await list()
    expect(row(b, ids.cody)).toMatchObject({ intervalDays: 30, intervalSource: 'client', status: 'due_soon', daysUntilDue: 10 })
    await owner()(`/api/supervisory-visits/client/${ids.cody}/interval`, { method: 'PUT', json: { days: null } })
  })
  test('the Payers & Codes form sets a code’s days: a whole number from 1 to 365, or blank for the agency’s rule', async () => {
    const [code] = (await t.db.select().from(t.schema.serviceCodes).where(eq(t.schema.serviceCodes.code, 'S5130'))) as any[]
    const put = (v: unknown) => json(owner()(`/api/service-codes/${code.id}`, { method: 'PUT', json: { supervisoryIntervalDays: v } }))
    expect((await put(0)).status).toBe(400)
    expect((await put(10.5)).body.fields?.supervisoryIntervalDays ?? '').toContain('whole number')
    expect((await put('180')).body.supervisoryIntervalDays).toBe(180)
    expect((await put('')).body.supervisoryIntervalDays).toBeNull()
    expect((await put(7)).body.supervisoryIntervalDays).toBe(7)
  })
})

describe('planned on the calendar, done from the phone', () => {
  test('the office plans a visit for a named supervisor; a time already past, nobody, or a second plan is refused', async () => {
    const o = owner()
    const past = at(-2)
    expect((await json(o(`/api/supervisory-visits/client/${ids.cody}/plan`, { method: 'POST', json: { ...past, supervisorId: ids.nina } }))).body.code).toBe('bad_time')
    expect((await json(o(`/api/supervisory-visits/client/${ids.cody}/plan`, { method: 'POST', json: { ...at(30), supervisorId: 'nobody' } }))).body.code).toBe('bad_supervisor')
    const when = at(30)
    const made = await json(o(`/api/supervisory-visits/client/${ids.cody}/plan`, { method: 'POST', json: { ...when, supervisorId: ids.nina } }))
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ status: 'planned', supervisorId: ids.nina, visitDate: when.date })
    expect(made.body.supervisorSignature).toBeUndefined()
    ids.plan = made.body.id
    expect((await json(o(`/api/supervisory-visits/client/${ids.cody}/plan`, { method: 'POST', json: { ...at(50), supervisorId: ids.nina } }))).status).toBe(409)
    // a planned visit is not a done one: still overdue, with the plan shown beside it
    const r = row(await list(), ids.cody)
    expect(r).toMatchObject({ status: 'overdue', lastVisit: null, plannedId: ids.plan, plannedDate: when.date, plannedSupervisorName: 'Nina Nurse', plannedTime: expect.any(String) })
    const cal = (await json(o(`/api/supervisory-visits/calendar?from=${day(-1)}&to=${day(7)}`))).body.data
    expect(cal.map((v: any) => [v.id, v.clientFirstName, v.supervisorName])).toEqual([[ids.plan, 'Cody', 'Nina Nurse']])
    expect((await json(o(`/api/supervisory-visits/calendar?from=${day(0)}&to=${day(100)}`))).body.code).toBe('range_too_long')
  })

  test('only the supervisor named on it gets it on their phone; the office cannot be bypassed by a caregiver', async () => {
    const mine = (await json(as('nina')('/api/supervisory-visits/mine'))).body
    expect(mine.visits.map((v: any) => [v.id, v.clientFirstName])).toEqual([[ids.plan, 'Cody']])
    expect((await json(as('ann')('/api/supervisory-visits/mine'))).body.visits).toEqual([])
    expect((await as('ann')(`/api/supervisory-visits/visits/${ids.plan}`)).status).toBe(404)
    expect((await as('ann')(`/api/supervisory-visits/visits/${ids.plan}/complete`, { method: 'POST', json: { concerns: 'x' } })).status).toBe(404)
    // the office's own pages stay closed to a field seat
    expect((await as('nina')('/api/supervisory-visits')).status).toBe(403)
    expect((await as('nina')(`/api/supervisory-visits/client/${ids.cody}/plan`, { method: 'POST', json: { ...at(40), supervisorId: ids.nina } })).status).toBe(403)
  })

  test('the supervisor is reminded once in the 24 hours before; a moved visit is reminded again', async () => {
    texts.length = 0; emails.length = 0
    // 30 hours away: not yet
    expect(await core.supervisory.scanReminders()).toBe(0)
    // the office moves it to 3 hours from now: reminded now, once
    const moved = await json(owner()(`/api/supervisory-visits/visits/${ids.plan}`, { method: 'PUT', json: at(3) }))
    expect(moved.status).toBe(200)
    expect(await core.supervisory.scanReminders()).toBe(1)
    expect(await core.supervisory.scanReminders()).toBe(0)
    expect(texts.map((m) => m.toPhone)).toEqual(['+16085550177'])
    expect(texts[0].message).toMatch(/^Supervisory visit with Cody Coded (today|tomorrow) at /)
    expect(emails.map((m) => m.to)).toEqual(['nina@test.example'])
    const notes = (await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.userId, ids.nina))) as any[]
    expect(notes.some((n) => n.title === 'Supervisory visit coming up')).toBe(true)
    // moved again: the reminder starts over
    await owner()(`/api/supervisory-visits/visits/${ids.plan}`, { method: 'PUT', json: at(5) })
    expect(await core.supervisory.scanReminders()).toBe(1)
  })

  test('the agency\'s own questions and required signatures; the supervisor starts, fills in and signs; the clock restarts', async () => {
    const o = owner()
    expect((await json(o('/api/supervisory-visits/settings', { method: 'PUT', json: { questions: [{ label: 'x'.repeat(201), kind: 'text' }] } }))).body.code).toBe('bad_questions')
    const saved = await json(o('/api/supervisory-visits/settings', { method: 'PUT', json: { requireSignatures: true, questions: [{ label: 'Is the smoke alarm working?', kind: 'yes_no', required: true }, { label: 'Anything the family asked for?', kind: 'text' }] } }))
    expect(saved.status).toBe(200)
    const n = as('nina')
    const opened = (await json(n(`/api/supervisory-visits/visits/${ids.plan}`))).body
    expect(opened).toMatchObject({ status: 'planned', clientFirstName: 'Cody', requireSignatures: true })
    expect(opened.questions.map((q: any) => q.id)).toEqual(['is_the_smoke_alarm_working', 'anything_the_family_asked_for'])
    expect((await json(n(`/api/supervisory-visits/visits/${ids.plan}/start`, { method: 'POST' }))).body.startedAt).toBeTruthy()
    const done = (b: any) => json(n(`/api/supervisory-visits/visits/${ids.plan}/complete`, { method: 'POST', json: { from: 'phone', ...b } }))
    expect((await done({ concerns: 'Rug in the hall' })).body.code).toBe('answer_required')
    expect((await done({ concerns: 'Rug in the hall', answers: { is_the_smoke_alarm_working: 'no' } })).body.code).toBe('signature_required')
    const ok = await done({ concerns: 'Rug in the hall', carePlanFollowed: true, answers: { is_the_smoke_alarm_working: 'no', anything_the_family_asked_for: 'A later start on Tuesdays' }, supervisorSignature: SIG, clientSignature: SIG })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ status: 'done', recordedFrom: 'phone', visitDate: day(0), answers: [{ id: 'is_the_smoke_alarm_working', answer: false }, { id: 'anything_the_family_asked_for', answer: 'A later start on Tuesdays' }] })
    expect(ok.body.signedAt).toBeTruthy()
    expect(ok.body.clientSignature).toBeUndefined()
    expect((await done({ concerns: 'again', supervisorSignature: SIG, clientSignature: SIG, answers: { is_the_smoke_alarm_working: 'yes' } })).status).toBe(409)
    // the clock restarts on the code's 14 days; the history and the signatures are the office's
    expect(row(await list(), ids.cody)).toMatchObject({ lastVisit: day(0), status: 'due_soon', daysUntilDue: 14, plannedId: null })
    const hist = (await json(o(`/api/supervisory-visits/client/${ids.cody}`))).body.data
    expect(hist[0]).toMatchObject({ supervisorName: 'Nina Nurse', supervisorSigned: true, clientSigned: true, concerns: 'Rug in the hall' })
    expect((await json(o(`/api/supervisory-visits/visits/${ids.plan}/signatures`))).body).toMatchObject({ supervisorSignature: SIG, clientSignature: SIG })
    expect((await json(as('nina')('/api/supervisory-visits/mine'))).body.visits).toEqual([])
  })

  test('the office can hand a visit to someone else or cancel it; a done visit cannot be moved', async () => {
    const o = owner()
    const p = await json(o(`/api/supervisory-visits/client/${ids.pat}/plan`, { method: 'POST', json: { ...at(48), supervisorId: ids.nina, visitType: 'phone' } }))
    expect(p.status).toBe(201)
    expect((await json(o(`/api/supervisory-visits/visits/${p.body.id}`, { method: 'PUT', json: { supervisorId: ids.ann } }))).body.supervisorId).toBe(ids.ann)
    expect((await json(as('nina')('/api/supervisory-visits/mine'))).body.visits).toEqual([])
    expect((await json(as('ann')('/api/supervisory-visits/mine'))).body.visits.map((v: any) => v.id)).toEqual([p.body.id])
    expect((await json(o(`/api/supervisory-visits/visits/${p.body.id}/cancel`, { method: 'POST' }))).body.status).toBe('cancelled')
    expect((await json(as('ann')('/api/supervisory-visits/mine'))).body.visits).toEqual([])
    expect((await json(o(`/api/supervisory-visits/visits/${ids.plan}`, { method: 'PUT', json: at(10) }))).status).toBe(409)
    expect(row(await list(), ids.pat).plannedId).toBeNull()
  })

  test('without the feature none of it is there', async () => {
    await setFeatures(BASE)
    expect((await as('nina')('/api/supervisory-visits/mine')).status).toBe(403)
    await setFeatures(ON)
  })
})
