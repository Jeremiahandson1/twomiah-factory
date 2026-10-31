// Home care parity row 13 (docs/parity/homecare-margin-turnover.md): caregiver satisfaction surveys pushed to the phone at set points
// (first visit with a client, N days after hire, every N days), low scores alerting the office, results by branch / manager /
// caregiver with a trend, a retention dashboard, and an at-risk score per caregiver with its reasons and its trend — from our own
// signals. Behind care_caregiver_surveys.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { checkSurvey, checkAnswers, duePoints, STANDARD_QUESTIONS } from '../server/crm/homecare/core/caregiverSurveys.ts'
import { scoreRisk, bandOf } from '../server/crm/homecare/core/retentionRisk.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const get = async (p: string, who = 'owner') => json(await as(who)(p))
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const ON = ['contacts', 'scheduling', 'team', 'care_caregiver_surveys']
const pushes: any[] = []
let today = ''
const daysAgo = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'UTC' } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  core = createHomecareCore({ services: t.services.crm } as any)
  core.notify._setPushSender(async (userId: string, payload: any) => { pushes.push({ userId, payload }); return 1 })
  today = await core.time.today(companyId)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.north = (await ins(t.schema.serviceLocations, { companyId, name: 'North branch' })).id
  ids.mgr = (await ins(t.schema.user, { email: 'mgr@test.example', passwordHash: hash, firstName: 'Mia', lastName: 'Manager', role: 'admin', companyId })).id
  const mk = async (who: string, hiredDaysAgo: number, profile: any = {}) => {
    ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId, hireDate: daysAgo(hiredDaysAgo) })).id
    await ins(t.schema.caregiverProfiles, { companyId, caregiverId: ids[who], ...profile })
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
  }
  await mk('ann', 400, { branchId: ids.north, managerUserId: ids.mgr })   // long-standing, hours falling
  await mk('bob', 90, { branchId: ids.north })                             // 90 days in today
  await mk('cy', 30, {})                                                    // new, first visit with a client yesterday
  ids.alma = (await ins(t.schema.clients, { companyId, firstName: 'Alma', lastName: 'Able', isActive: true })).id
  // Ann: 20 h a week for 8 weeks, then 8 h a week for 4 weeks; one call-out and one missed visit lately; she wants 30 h.
  const visit = async (who: string, d: string, hours: number) => ins(t.schema.timeEntries, { companyId, caregiverId: ids[who], clientId: ids.alma, startTime: new Date(`${d}T09:00:00Z`), endTime: new Date(`${d}T${String(9 + hours).padStart(2, '0')}:00:00Z`), isComplete: true, durationMinutes: hours * 60 })
  for (let w = 1; w <= 12; w++) for (const dow of [1, 3]) { const d = daysAgo(w * 7 - dow); if (d < today) await visit('ann', d, w <= 4 ? 4 : 10) }
  await ins(t.schema.caregiverAvailability, { companyId, caregiverId: ids.ann, hoursWanted: 30, maxHoursPerWeek: 40 })
  await ins(t.schema.absences, { companyId, caregiverId: ids.ann, date: daysAgo(10), type: 'sick' })
  await ins(t.schema.noshowAlerts, { companyId, caregiverId: ids.ann, clientId: ids.alma, shiftDate: daysAgo(5), expectedStart: '09:00' })
  await visit('cy', daysAgo(1), 2)
  await setFeatures(ON)
}, 120_000)

describe('row 13 — the rules (pure)', () => {
  test('a survey is checked: a name, a trigger, days where they apply, questions of a known kind, an alert line', () => {
    expect(checkSurvey({ name: '', trigger: 'every_days', days: 30, questions: STANDARD_QUESTIONS })).toMatchObject({ fields: { name: 'Name it' } })
    expect(checkSurvey({ name: 'x', trigger: 'monthly', questions: STANDARD_QUESTIONS })).toMatchObject({ fields: { trigger: 'Pick one' } })
    expect(checkSurvey({ name: 'x', trigger: 'days_after_hire', days: 0, questions: STANDARD_QUESTIONS })).toMatchObject({ fields: { days: '1 to 730' } })
    expect(checkSurvey({ name: 'x', trigger: 'days_after_hire', days: 90, questions: [] })).toMatchObject({ fields: { questions: 'Add a question' } })
    expect(checkSurvey({ name: 'x', trigger: 'days_after_hire', days: 90, questions: [{ text: 'Hi?', kind: 'emoji' }] })).toMatchObject({ fields: { questions: 'Question 1: pick a kind' } })
    expect(checkSurvey({ name: 'x', trigger: 'days_after_hire', days: 90, questions: STANDARD_QUESTIONS, alertBelow: 9 })).toMatchObject({ fields: { alertBelow: '1 to 5' } })
    const ok = checkSurvey({ name: ' First visit ', trigger: 'first_visit_with_client', days: 7, questions: [{ text: 'Happy?', kind: 'scale' }], alertBelow: 3 })
    expect(ok).toEqual({ input: { name: 'First visit', trigger: 'first_visit_with_client', days: null, questions: [{ id: 'q1', text: 'Happy?', kind: 'scale' }], alertBelow: 3, isActive: true } })
  })
  test('answers are checked against the questions and scored (the average of the scale answers)', () => {
    const qs = STANDARD_QUESTIONS
    expect(checkAnswers(qs, { q1: 6 })).toMatchObject({ fields: { q1: 'Pick 1 to 5' } })
    expect(checkAnswers(qs, { q1: 4, q2: 4, q3: 2, q4: 5 })).toMatchObject({ fields: { q5: 'Yes or no' } })
    expect(checkAnswers(qs, { q1: 4, q2: 4, q3: 2, q4: 5, q5: 'no', q6: '  more hours ' })).toEqual({ answers: { q1: 4, q2: 4, q3: 2, q4: 5, q5: false, q6: 'more hours' }, score: 375, comment: 'more hours' })
    expect(checkAnswers([{ id: 'a', text: 'Yes?', kind: 'yes_no' }], { a: true })).toMatchObject({ score: null })
  })
  test('the points that fall due: a first visit once per client, N days after hire once, a cycle once per period, nothing stale', () => {
    const firsts = [{ clientId: 'c1', firstVisit: '2026-10-30', clientName: 'Alma Able' }, { clientId: 'c2', firstVisit: '2026-09-01', clientName: 'Old One' }]
    expect(duePoints({ trigger: 'first_visit_with_client', days: null }, { hired: '2026-01-01' }, '2026-10-31', firsts)).toEqual([{ pointKey: 'client:c1', dueOn: '2026-10-30', reason: 'Your first visit with Alma Able', clientId: 'c1' }])
    expect(duePoints({ trigger: 'days_after_hire', days: 90 }, { hired: '2026-08-02' }, '2026-10-31', [])).toEqual([{ pointKey: 'hire:90', dueOn: '2026-10-31', reason: '90 days with the agency', clientId: null }])
    expect(duePoints({ trigger: 'days_after_hire', days: 90 }, { hired: '2026-09-01' }, '2026-10-31', [])).toEqual([])
    expect(duePoints({ trigger: 'days_after_hire', days: 90 }, { hired: '2026-01-01' }, '2026-10-31', [])).toEqual([]) // long past: not asked out of the blue
    expect(duePoints({ trigger: 'every_days', days: 30 }, { hired: '2026-08-01' }, '2026-10-31', [])).toEqual([{ pointKey: 'cycle:2026-10-30', dueOn: '2026-10-30', reason: 'Your regular check-in', clientId: null }])
    expect(duePoints({ trigger: 'every_days', days: 30 }, { hired: '2026-10-15' }, '2026-10-31', [])).toEqual([])
  })
  test('the risk score adds up our own signals and says why', () => {
    const base = { hoursLast4Weeks: 80, hoursPrevious8Weeks: 160, lastVisit: '2026-10-30', calloutsSixtyDays: 0, missedSixtyDays: 0, latestScore: null, latestScoreOn: null, unansweredSurveys: 0, hoursWanted: null, hired: '2025-01-01' }
    expect(scoreRisk(base, '2026-10-31')).toEqual({ score: 0, band: 'low', reasons: [] })
    const falling = scoreRisk({ ...base, hoursLast4Weeks: 32 }, '2026-10-31')
    expect(falling.reasons).toEqual([{ signal: 'hours_drop', label: 'Hours dropped', points: 30, detail: 'Working 8 h a week over the last 4 weeks, down from 20 h over the 8 before (60% less)' }])
    const r = scoreRisk({ ...base, hoursLast4Weeks: 56, calloutsSixtyDays: 2, missedSixtyDays: 1, latestScore: 250, latestScoreOn: '2026-10-20', unansweredSurveys: 1, hoursWanted: 40 }, '2026-10-31')
    expect(r.reasons.map((x) => [x.signal, x.points])).toEqual([['survey_low', 25], ['callouts', 20], ['hours_drop', 15], ['missed', 10], ['survey_unanswered', 10], ['under_wish', 10]])
    expect(r).toMatchObject({ score: 90, band: 'high' })
    expect(scoreRisk({ ...base, hired: '2026-10-01' }, '2026-10-31').reasons[0]).toMatchObject({ signal: 'new', points: 15, detail: 'Hired 30 days ago — most caregivers who leave do so in their first 90 days' })
    expect(scoreRisk({ ...base, lastVisit: '2026-09-01' }, '2026-10-31').reasons[0]).toMatchObject({ signal: 'quiet', points: 30 })
    expect([bandOf(0), bandOf(25), bandOf(49), bandOf(50), bandOf(100)]).toEqual(['low', 'watch', 'watch', 'high', 'high'])
  })
})

describe('row 13 — surveys pushed at set points, answered on the phone, low scores alerting the office', () => {
  test('the office writes surveys (from the standard questions) and the scan asks each due point once, by push and in-app notice', async () => {
    const opt = await get('/api/caregiver-surveys/options')
    expect(opt.body.standardQuestions.length).toBe(6)
    const s90 = await json(await as('owner')('/api/caregiver-surveys/surveys', { method: 'POST', json: { name: '90 days in', trigger: 'days_after_hire', days: 90, questions: opt.body.standardQuestions, alertBelow: 3 } }))
    expect(s90.status).toBe(201)
    expect(s90.body.triggerLabel).toBe('90 days after they were hired')
    ids.s90 = s90.body.id
    const sFirst = await json(await as('owner')('/api/caregiver-surveys/surveys', { method: 'POST', json: { name: 'First visit', trigger: 'first_visit_with_client', questions: [{ text: 'How did the first visit go?', kind: 'scale' }, { text: 'Anything to tell us?', kind: 'text' }], alertBelow: 3 } }))
    ids.sFirst = sFirst.body.id
    expect((await json(await as('owner')('/api/caregiver-surveys/surveys', { method: 'POST', json: { name: 'x', trigger: 'every_days', days: 0, questions: [] } }))).body.code).toBe('bad_survey')
    pushes.length = 0
    expect(await core.caregiverSurveys.scanCompany(companyId)).toBe(2)   // Bob is 90 days in; Cy had his first visit with Alma yesterday
    expect(await core.caregiverSurveys.scanCompany(companyId)).toBe(0)   // asked once
    expect(pushes.map((p) => [p.userId, p.payload.data.type]).sort()).toEqual([[ids.bob, 'caregiver_survey'], [ids.cy, 'caregiver_survey']].sort())
    const bob = await get('/api/caregiver-surveys/me', 'bob')
    expect(bob.body.pending.length).toBe(1)
    expect(bob.body.pending[0]).toMatchObject({ surveyName: '90 days in', reason: '90 days with the agency', dueOn: today })
    expect(bob.body.pending[0].questions.length).toBe(6)
    const cy = await get('/api/caregiver-surveys/me', 'cy')
    expect(cy.body.pending[0]).toMatchObject({ surveyName: 'First visit', reason: 'Your first visit with Alma Able' })
    expect((await get('/api/caregiver-surveys/me', 'ann')).body.pending).toEqual([])
    const notices = await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.userId, ids.bob))
    expect(notices.some((n: any) => n.type === 'caregiver_survey')).toBe(true)
    const out = await get('/api/caregiver-surveys/outstanding')
    expect(out.body.data.map((o: any) => o.name).sort()).toEqual(['Bob Carer', 'Cy Carer'])
    expect(out.body.data[0].pushed).toBe(true)
  })

  test('a caregiver answers only their own; a low score tells the office; a second answer is refused', async () => {
    const bob = (await get('/api/caregiver-surveys/me', 'bob')).body.pending[0]
    expect((await json(await as('cy')(`/api/caregiver-surveys/me/${bob.id}/answer`, { method: 'POST', json: { q1: 5 } }))).status).toBe(404)
    const bad = await json(await as('bob')(`/api/caregiver-surveys/me/${bob.id}/answer`, { method: 'POST', json: { q1: 2 } }))
    expect(bad.status).toBe(400)
    expect(bad.body.fields).toEqual({ q2: 'Pick 1 to 5' })
    const low = await json(await as('bob')(`/api/caregiver-surveys/me/${bob.id}/answer`, { method: 'POST', json: { q1: 2, q2: 2, q3: 1, q4: 3, q5: false, q6: 'The schedule keeps changing' } }))
    expect(low.status).toBe(200)
    expect(low.body).toMatchObject({ success: true, score: 2 })
    const alerts = await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.type, 'caregiver_survey_low'))
    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts[0].message).toContain('Bob Carer scored 2.0 of 5 on "90 days in"')
    expect(alerts[0].message).toContain('The schedule keeps changing')
    expect((await json(await as('bob')(`/api/caregiver-surveys/me/${bob.id}/answer`, { method: 'POST', json: { q1: 5, q2: 5, q3: 5, q4: 5, q5: true } }))).status).toBe(409)
    const cy = (await get('/api/caregiver-surveys/me', 'cy')).body.pending[0]
    const fine = await json(await as('cy')(`/api/caregiver-surveys/me/${cy.id}/answer`, { method: 'POST', json: { q1: 5 } }))
    expect(fine.body.score).toBe(5)
    expect((await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.type, 'caregiver_survey_low'))).length).toBe(alerts.length)
    expect((await get('/api/caregiver-surveys/me', 'bob')).body.answered[0]).toMatchObject({ surveyName: '90 days in', score: 200 })
  })

  test('results by branch, manager and caregiver, the trend and the response rate; "ask now" by hand', async () => {
    const r = await get('/api/caregiver-surveys/results')
    expect(r.body.summary).toMatchObject({ sent: 2, answered: 2, responseRatePercent: 100, averageScore: 3.5, low: 1 })
    expect(r.body.byBranch).toEqual([{ id: ids.north, name: 'North branch', answered: 1, averageScore: 2, low: 1 }, { id: null, name: 'No branch', answered: 1, averageScore: 5, low: 0 }])
    expect(r.body.byManager.map((g: any) => [g.name, g.averageScore])).toEqual([['No manager', 3.5]])
    expect(r.body.byCaregiver.map((g: any) => [g.name, g.averageScore, g.low])).toEqual([['Bob Carer', 2, 1], ['Cy Carer', 5, 0]])
    expect(r.body.trend).toEqual([{ month: today.slice(0, 7), answered: 2, averageScore: 3.5, low: 1 }])
    expect(r.body.answers.find((a: any) => a.name === 'Bob Carer')).toMatchObject({ comment: 'The schedule keeps changing', alerted: true, score: 2, branchName: 'North branch' })
    const asked = await json(await as('owner')(`/api/caregiver-surveys/surveys/${ids.sFirst}/ask`, { method: 'POST', json: { caregiverIds: [ids.ann] } }))
    expect(asked.body).toMatchObject({ success: true, sent: 1 })
    expect((await get('/api/caregiver-surveys/me', 'ann')).body.pending[0].reason).toBe('The office would like to hear from you')
    expect((await json(await as('owner')(`/api/caregiver-surveys/surveys/${ids.sFirst}/ask`, { method: 'POST', json: { caregiverIds: [ids.ann] } }))).body.sent).toBe(0)
    expect((await as('ann')('/api/caregiver-surveys/results')).status).toBe(403)
  })

  test('the at-risk list scores each caregiver from our signals with the reasons shown; the scan writes the daily snapshot for the trend', async () => {
    const r = await get('/api/caregiver-surveys/risk')
    expect(r.status).toBe(200)
    const ann = r.body.data.find((x: any) => x.name === 'Ann Carer')
    expect(ann).toMatchObject({ band: 'high', bandLabel: 'At risk', branchName: 'North branch', managerName: 'Mia Manager' })
    expect(ann.reasons.map((x: any) => x.signal)).toEqual(['hours_drop', 'callouts', 'missed', 'under_wish'])
    expect(ann.reasons[0].detail).toMatch(/^Working 8 h a week over the last 4 weeks, down from 20 h over the 8 before \(60% less\)$/)
    expect(ann.score).toBe(30 + 10 + 10 + 10)
    const bob = r.body.data.find((x: any) => x.name === 'Bob Carer')
    expect(bob.reasons.map((x: any) => [x.signal, x.points])).toEqual([['survey_low', 25], ['newish', 5]])
    expect(bob).toMatchObject({ score: 30, band: 'watch' })
    const cy = r.body.data.find((x: any) => x.name === 'Cy Carer')
    expect(cy.reasons.map((x: any) => x.signal)).toEqual(['new'])
    expect(r.body.data.map((x: any) => x.name)).toEqual(['Ann Carer', 'Bob Carer', 'Cy Carer'])
    // the snapshot (written by the scan) feeds the trend
    const trend = await get(`/api/caregiver-surveys/risk/${ids.ann}/trend`)
    expect(trend.body.data).toEqual([{ asOf: today, score: 60, band: 'high', bandLabel: 'At risk' }])
    // a later run the same day replaces the day's snapshot (Bob's low score came after the scan)
    expect(await core.risk.snapshot(companyId, today)).toBe(3)
    const dash = await get('/api/caregiver-surveys/dashboard?days=90')
    expect(dash.body.risk).toMatchObject({ atRisk: 1, watch: 1, caregivers: 3 })
    expect(dash.body.risk.list.map((x: any) => x.name)).toEqual(['Ann Carer', 'Bob Carer'])
    expect(dash.body.risk.trend).toEqual([{ asOf: today, averageScore: 35, atRisk: 1, watch: 1, caregivers: 3 }])
    expect(dash.body.satisfaction.summary.averageScore).toBe(3.5)
    expect(dash.body.satisfaction.trend.length).toBe(1)
    // the Reports & dashboards tile reads the same
    const tile = await core.caregiverSurveys.dashboardTile(companyId, today)
    expect(tile).toMatchObject({ latestAverage: 3.5, responseRatePercent: 66.7, atRisk: 1, watch: 1 })
    expect((tile as any).topReasons[0]).toMatchObject({ name: 'Ann Carer', score: 60 })
  })

  test('without the feature everything is refused and the scan does nothing', async () => {
    await setFeatures(['contacts', 'scheduling', 'team'])
    for (const p of ['/me', '/surveys', '/results', '/dashboard', '/risk', '/outstanding']) {
      const r = await get(`/api/caregiver-surveys${p}`)
      expect(r.status).toBe(403)
      expect(r.body.feature).toBe('care_caregiver_surveys')
    }
    expect(await core.caregiverSurveys.scanCompany(companyId)).toBe(0)
    expect(await core.caregiverSurveys.dashboardTile(companyId, today)).toEqual({ withheld: 'feature' })
    await setFeatures(ON)
  })
})
