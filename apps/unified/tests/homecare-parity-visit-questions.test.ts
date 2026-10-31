// Home care parity row 3 (docs/parity/homecare-daily-care-wording.md, "custom questions at shift start or end"): questions the
// caregiver answers at clock-in and clock-out. The agency writes them; required ones must be answered on a live punch; a punch
// saved offline is kept; the answers stay on the visit; a worrying answer tells the office. Behind care_visit_questions.
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { checkAnswers, isFlagged, tidyAnswer } from '../server/crm/homecare/core/visitQuestions.ts'

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
const ON = ['contacts', 'scheduling', 'team', 'care_visit_questions']
const ask = async (b: any) => (await json(await as('owner')('/api/visit-questions', { method: 'POST', json: b }))).body
const clockIn = async (answers?: any, extra: any = {}) => json(await as('ann')('/api/time-entries/clock-in', { method: 'POST', json: { clientId: ids.pat, latitude: 44.8, longitude: -91.5, ...(answers ? { answers } : {}), ...extra } }))
const clockOut = async (id: string, answers?: any, extra: any = {}) => json(await as('ann')(`/api/time-entries/${id}/clock-out`, { method: 'POST', json: { notes: 'fine', ...(answers ? { answers } : {}), ...extra } }))
const clearQuestions = async () => { await t.db.delete(t.schema.visitQuestion) }
const closeOpen = async () => { await t.db.update(t.schema.timeEntries).set({ endTime: sql`start_time + INTERVAL '1 minute'`, isComplete: true } as any).where(isNull(t.schema.timeEntries.endTime)) }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  await setFeatures(ON)
}, 90_000)
beforeEach(async () => { await closeOpen(); await clearQuestions() })

describe('home care parity row 3 — the rules', () => {
  test('answers are tidied: yes/no, one of the choices, a short text; anything else is a plain sentence', () => {
    expect(tidyAnswer({ kind: 'yes_no', options: null }, 'YES')).toEqual({ answer: 'yes' })
    expect(tidyAnswer({ kind: 'yes_no', options: null }, false)).toEqual({ answer: 'no' })
    expect(tidyAnswer({ kind: 'yes_no', options: null }, 'maybe')).toHaveProperty('problem')
    expect(tidyAnswer({ kind: 'choice', options: ['Good', 'Poor'] }, 'poor')).toEqual({ answer: 'Poor' })
    expect(tidyAnswer({ kind: 'choice', options: ['Good', 'Poor'] }, 'fair')).toHaveProperty('problem')
    expect(tidyAnswer({ kind: 'text', options: null }, '  ok  ')).toEqual({ answer: 'ok' })
    expect(tidyAnswer({ kind: 'text', options: null }, '')).toHaveProperty('problem')
    expect(tidyAnswer({ kind: 'text', options: null }, 'x'.repeat(1001))).toHaveProperty('problem')
  })
  test('a required question left blank is a problem only when enforced; an unknown question is ignored', () => {
    const qs: any[] = [{ id: 'a', kind: 'yes_no', options: null, required: true, flagOn: 'no' }, { id: 'b', kind: 'text', options: null, required: false, flagOn: null }]
    expect(checkAnswers(qs, [], true).problems).toEqual({ a: 'This question needs an answer.' })
    expect(checkAnswers(qs, [], false)).toEqual({ clean: [], problems: {} })
    expect(checkAnswers(qs, [{ questionId: 'a', answer: 'yes' }, { questionId: 'zzz', answer: 'x' }], true)).toEqual({ clean: [{ questionId: 'a', answer: 'yes' }], problems: {} })
    expect(isFlagged(qs[0], 'No')).toBe(true)
    expect(isFlagged(qs[1], 'No')).toBe(false)
  })
})

describe('home care parity row 3 — the agency writes the questions', () => {
  test('the office adds, edits and removes questions; a caregiver cannot; bad ones are refused in plain words', async () => {
    const q = await json(await as('owner')('/api/visit-questions', { method: 'POST', json: { prompt: 'Was the home safe to enter?', kind: 'yes_no', phase: 'clock_in', required: true, flagOn: 'no' } }))
    expect(q.status).toBe(201)
    expect(q.body).toMatchObject({ prompt: 'Was the home safe to enter?', kind: 'yes_no', flagOn: 'no', required: true })
    expect((await json(await as('ann')('/api/visit-questions', { method: 'POST', json: { prompt: 'x', kind: 'text', phase: 'both' } }))).status).toBe(403)
    expect((await json(await as('ann')('/api/visit-questions'))).status).toBe(403)
    const bad = await json(await as('owner')('/api/visit-questions', { method: 'POST', json: { prompt: '', kind: 'text', phase: 'both' } }))
    expect(bad.status).toBe(400)
    expect(bad.body.fields.prompt).toBeTruthy()
    expect((await json(await as('owner')('/api/visit-questions', { method: 'POST', json: { prompt: 'How?', kind: 'choice', options: ['One'], phase: 'both' } }))).body.fields.options).toBeTruthy()
    expect((await json(await as('owner')('/api/visit-questions', { method: 'POST', json: { prompt: 'Note?', kind: 'text', phase: 'both', flagOn: 'bad' } }))).body.fields.flagOn).toBeTruthy()
    expect((await json(await as('owner')('/api/visit-questions', { method: 'POST', json: { prompt: 'Safe?', kind: 'yes_no', phase: 'sometimes' } }))).body.fields.phase).toBeTruthy()
    const edited = await json(await as('owner')(`/api/visit-questions/${q.body.id}`, { method: 'PUT', json: { prompt: 'Was the home safe?', required: false } }))
    expect(edited.body).toMatchObject({ prompt: 'Was the home safe?', required: false, flagOn: 'no' })
    expect((await as('owner')(`/api/visit-questions/${q.body.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await json(await as('owner')('/api/visit-questions'))).body.data.length).toBe(0)
  })

  test('the caregiver\'s phone asks for the active questions of each moment, in the agency\'s order', async () => {
    await ask({ prompt: 'Second in', kind: 'text', phase: 'clock_in', sortOrder: 2 })
    await ask({ prompt: 'First in', kind: 'yes_no', phase: 'clock_in', sortOrder: 1 })
    await ask({ prompt: 'Both ways', kind: 'choice', options: ['Good', 'Poor'], phase: 'both', sortOrder: 3 })
    await ask({ prompt: 'Out only', kind: 'text', phase: 'clock_out' })
    const off = await ask({ prompt: 'Switched off', kind: 'text', phase: 'clock_in', isActive: false })
    expect(off.isActive).toBe(false)
    const ins_ = await json(await as('ann')('/api/visit-questions/active?phase=clock_in'))
    expect(ins_.body.data.map((q: any) => q.prompt)).toEqual(['First in', 'Second in', 'Both ways'])
    const outs = await json(await as('ann')('/api/visit-questions/active?phase=clock_out'))
    expect(outs.body.data.map((q: any) => q.prompt).sort()).toEqual(['Both ways', 'Out only'])
    expect((await json(await as('ann')('/api/visit-questions/active'))).status).toBe(400)
  })

  test('with the feature off the screens are closed (403) and the punch asks nothing', async () => {
    await ask({ prompt: 'Needed?', kind: 'yes_no', phase: 'clock_in', required: true })
    await setFeatures(['contacts', 'scheduling', 'team'])
    expect((await as('owner')('/api/visit-questions')).status).toBe(403)
    expect((await as('ann')('/api/visit-questions/active?phase=clock_in')).status).toBe(403)
    const r = await clockIn()
    expect(r.status).toBe(201)
    await setFeatures(ON)
  })
})

describe('home care parity row 3 — at the punch', () => {
  test('a required question blocks a live clock-in (409, naming it), and answering lets it through and is kept on the visit', async () => {
    const q = await ask({ prompt: 'Was the home safe to enter?', kind: 'yes_no', phase: 'clock_in', required: true, flagOn: 'no' })
    const refused = await clockIn()
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('questions_required')
    expect(refused.body.error).toContain('Was the home safe to enter?')
    expect(refused.body.fields[q.id]).toBeTruthy()
    expect((await t.db.select().from(t.schema.timeEntries).where(isNull(t.schema.timeEntries.endTime))).length).toBe(0)
    const badAnswer = await clockIn([{ questionId: q.id, answer: 'perhaps' }])
    expect(badAnswer.status).toBe(409)
    const ok = await clockIn([{ questionId: q.id, answer: 'Yes' }])
    expect(ok.status).toBe(201)
    const kept = await json(await as('owner')(`/api/visit-questions/answers?timeEntryId=${ok.body.id}`))
    expect(kept.body.data.length).toBe(1)
    expect(kept.body.data[0]).toMatchObject({ prompt: 'Was the home safe to enter?', answer: 'yes', phase: 'clock_in', flagged: false, caregiverFirst: 'Ann', clientFirst: 'Pat' })
  })

  test('an optional question can be skipped; a required one at clock-out blocks the clock-out and the visit stays open', async () => {
    await ask({ prompt: 'Any concerns?', kind: 'text', phase: 'clock_in' })
    const q2 = await ask({ prompt: 'How was Pat today?', kind: 'choice', options: ['Good', 'Fair', 'Poor'], phase: 'clock_out', required: true })
    const inn = await clockIn()
    expect(inn.status).toBe(201)
    const refused = await clockOut(inn.body.id)
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('questions_required')
    const still = await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, inn.body.id))
    expect(still[0].endTime).toBeNull()
    const out = await clockOut(inn.body.id, [{ questionId: q2.id, answer: 'good' }])
    expect(out.status).toBe(200)
    const kept = await json(await as('owner')(`/api/visit-questions/answers?timeEntryId=${inn.body.id}`))
    expect(kept.body.data.map((a: any) => [a.phase, a.answer])).toEqual([['clock_out', 'Good']])
  })

  test('a worrying answer is flagged on the record and told to the office, once', async () => {
    const q = await ask({ prompt: 'Was the home safe to enter?', kind: 'yes_no', phase: 'clock_in', required: true, flagOn: 'no' })
    const inn = await clockIn([{ questionId: q.id, answer: 'no' }])
    expect(inn.status).toBe(201)
    const notes = (await t.db.select().from(t.schema.notifications).where(and(eq(t.schema.notifications.userId, (await t.db.select().from(t.schema.user).where(eq(t.schema.user.role, 'owner')))[0].id), eq(t.schema.notifications.type, 'visit_answer_flag')))) as any[]
    expect(notes.length).toBe(1)
    expect(notes[0].message).toBe('Ann Carer at Pat Client\'s clock-in: "Was the home safe to enter?" — no.')
    const flagged = await json(await as('owner')('/api/visit-questions/answers?flagged=true'))
    expect(flagged.body.data.length).toBe(1)
    expect(flagged.body.data[0].flagged).toBe(true)
  })

  test('a punch saved on the phone without signal is never refused for a blank required question; what was answered is kept', async () => {
    const q = await ask({ prompt: 'Was the home safe to enter?', kind: 'yes_no', phase: 'clock_in', required: true })
    const q2 = await ask({ prompt: 'Took a break?', kind: 'yes_no', phase: 'clock_in' })
    await t.db.delete(t.schema.timeEntries) // an earlier test's visits would overlap a punch dated before them
    const at = new Date(Date.now() - 20 * 60_000).toISOString()
    const inn = await clockIn([{ questionId: q2.id, answer: 'yes' }], { offlineAt: at })
    expect(inn.status).toBe(201)
    expect(inn.body.approvalReason).toContain('offline')
    const kept = await json(await as('owner')(`/api/visit-questions/answers?timeEntryId=${inn.body.id}`))
    expect(kept.body.data.map((a: any) => a.answer)).toEqual(['yes'])
    void q
  })

  test('removing or editing a question later does not change what the visit says', async () => {
    const q = await ask({ prompt: 'Original wording?', kind: 'yes_no', phase: 'clock_in' })
    const inn = await clockIn([{ questionId: q.id, answer: 'yes' }])
    await as('owner')(`/api/visit-questions/${q.id}`, { method: 'PUT', json: { prompt: 'New wording?' } })
    await as('owner')(`/api/visit-questions/${q.id}`, { method: 'DELETE' })
    const kept = await json(await as('owner')(`/api/visit-questions/answers?timeEntryId=${inn.body.id}`))
    expect(kept.body.data[0].prompt).toBe('Original wording?')
  })
})
