// Home care parity rows 3 and 4, the edges left after the 10/31 builds (docs/parity/homecare-daily-care-wording.md):
//   row 3 (care_visit_questions): a NUMBER question with limits and flag levels; a flagged answer stays on the office's dashboard
//         until someone acknowledges it, who and when kept (AxisCare Care Vision); the answers show in Visit Documentation;
//   row 4 (care_visit_items): an agency-wide item for one service only (AlayaCare); the client's care-plan goals become goals tracked
//         on every visit; form completion shows in Visit Documentation.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { isFlagged, numberRules, tidyAnswer } from '../server/crm/homecare/core/visitQuestions.ts'
import { carePlanGoalLines } from '../server/crm/homecare/core/visitItems.ts'
import { agencyDay } from './agencyDay.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response | Promise<Response>) => { const x = await r; return { status: x.status, body: await x.json() as any } }
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const ON = ['contacts', 'scheduling', 'team', 'dashboard', 'care_visit_questions', 'care_visit_items']
const owner = () => as('owner')

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.personal = (await ins(t.schema.careTypes, { companyId, name: 'Personal care' })).id
  ids.companion = (await ins(t.schema.careTypes, { companyId, name: 'Companion' })).id
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true, careTypeId: ids.personal })).id
  ids.sam = (await ins(t.schema.clients, { companyId, firstName: 'Sam', lastName: 'Other', isActive: true, isPrivatePay: true, careTypeId: ids.companion })).id
  for (const c of [ids.pat, ids.sam]) await ins(t.schema.clientAssignments, { companyId, clientId: c, caregiverId: ids.ann, assignmentDate: '2026-10-01', status: 'active' })
  await setFeatures(ON)
}, 90_000)

describe('the rules (pure)', () => {
  test('a number answer is checked against its limits and flagged below or above the levels', () => {
    const q = { kind: 'number', options: { min: 90, max: 110, flagBelow: 95, flagAbove: 100.4 } }
    expect(tidyAnswer(q, '98.6')).toEqual({ answer: '98.6' })
    expect(tidyAnswer(q, 'warm')).toEqual({ problem: 'Answer with a number.' })
    expect(tidyAnswer(q, 120)).toEqual({ problem: 'The answer cannot be above 110.' })
    expect([isFlagged({ ...q, flagOn: null }, '101'), isFlagged({ ...q, flagOn: null }, '94'), isFlagged({ ...q, flagOn: null }, '98')]).toEqual([true, true, false])
    expect(numberRules({ min: '', max: 'x' })).toEqual({ min: null, max: null, flagBelow: null, flagAbove: null })
  })
  test('care-plan goals: one per line, bullets and numbers dropped, no repeats', () => {
    expect(carePlanGoalLines('1. Walk to the mailbox daily\n- Eat two full meals\n• eat two full meals\n\n  Stay hydrated; Join a social activity weekly')).toEqual(['Walk to the mailbox daily', 'Eat two full meals', 'Stay hydrated', 'Join a social activity weekly'])
  })
})

describe('row 3: number questions and acknowledging flagged answers', () => {
  test('the office writes a number question; its limits are checked', async () => {
    expect((await json(owner()('/api/visit-questions', { method: 'POST', json: { prompt: 'Temperature (°F)?', kind: 'number', phase: 'clock_in', options: { min: 110, max: 90 } } }))).body.code).toBe('bad_question')
    expect((await json(owner()('/api/visit-questions', { method: 'POST', json: { prompt: 'Temperature?', kind: 'number', phase: 'clock_in', flagOn: '100' } }))).body.fields.flagOn).toContain('below or above')
    const q = await json(owner()('/api/visit-questions', { method: 'POST', json: { prompt: 'Temperature (°F)?', kind: 'number', phase: 'clock_in', required: true, options: { min: 90, max: 110, flagAbove: 100.4 } } }))
    expect(q.status).toBe(201)
    ids.q = q.body.id
  })

  test('a high answer is flagged, waits on the dashboard, and is acknowledged once with who and when', async () => {
    const bad = await json(as('ann')('/api/time-entries/clock-in', { method: 'POST', json: { clientId: ids.pat, latitude: 44.8, longitude: -91.5, answers: [{ questionId: ids.q, answer: '130' }] } }))
    expect(bad.status).toBe(409)
    const inn = await json(as('ann')('/api/time-entries/clock-in', { method: 'POST', json: { clientId: ids.pat, latitude: 44.8, longitude: -91.5, answers: [{ questionId: ids.q, answer: '101.2' }] } }))
    expect(inn.status).toBe(201)
    ids.visit = inn.body.id
    const items = (await json(owner()('/api/dashboard/action-items'))).body.items as any[]
    expect(items.find((i) => i.key === 'visit_answers_to_acknowledge')).toMatchObject({ count: 1, page: 'visit-questions' })
    const waiting = (await json(owner()('/api/visit-questions/answers?unacknowledged=true'))).body.data
    expect(waiting.map((a: any) => [a.answer, a.flagged])).toEqual([['101.2', true]])
    const ack = await json(owner()(`/api/visit-questions/answers/${waiting[0].id}/acknowledge`, { method: 'POST' }))
    expect(ack.body).toMatchObject({ toAcknowledge: 0 })
    expect(ack.body.acknowledgedAt).toBeTruthy()
    const all = (await json(owner()('/api/visit-questions/answers?flagged=true'))).body.data
    expect(all[0]).toMatchObject({ acknowledgedByLast: 'Owner' })
    expect((await json(owner()('/api/visit-questions/answers?unacknowledged=true'))).body.data).toEqual([])
    expect(((await json(owner()('/api/dashboard/action-items'))).body.items as any[]).some((i) => i.key === 'visit_answers_to_acknowledge')).toBe(false)
    // a caregiver cannot acknowledge
    expect((await as('ann')(`/api/visit-questions/answers/${waiting[0].id}/acknowledge`, { method: 'POST' })).status).toBe(403)
  })
})

describe('row 4: items per service, goals from the care plan, and Visit Documentation', () => {
  test('an agency-wide item for one service shows only on visits of clients with that service', async () => {
    expect((await json(owner()('/api/visit-items', { method: 'POST', json: { kind: 'general_task', name: 'Check skin', clientId: ids.pat, careTypeId: ids.personal } }))).body.code).toBe('bad_item')
    const item = await json(owner()('/api/visit-items', { method: 'POST', json: { kind: 'general_task', name: 'Check skin for redness', careTypeId: ids.personal } }))
    expect(item.status).toBe(201)
    await json(owner()('/api/visit-items', { method: 'POST', json: { kind: 'general_task', name: 'Wash hands on arrival' } }))
    const names = async (visit: string) => ((await json(as('ann')(`/api/visit-items/visit/${visit}`))).body.data as any[]).map((i) => i.name).sort()
    expect(await names(ids.visit)).toEqual(['Check skin for redness', 'Wash hands on arrival'])
    ids.samVisit = (await ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.sam, startTime: new Date(Date.now() - 3_600_000), endTime: new Date(), isComplete: true })).id
    expect(await names(ids.samVisit)).toEqual(['Wash hands on arrival'])
  })

  test('the care plan’s goals become goals tracked on every visit, once', async () => {
    expect((await json(owner()(`/api/visit-items/goals/${ids.pat}/from-care-plan`, { method: 'POST' }))).body.code).toBe('no_care_plan')
    await ins(t.schema.carePlans, { companyId, clientId: ids.pat, careGoals: '1. Walk to the mailbox daily\n2. Eat two full meals' })
    const first = await json(owner()(`/api/visit-items/goals/${ids.pat}/from-care-plan`, { method: 'POST' }))
    expect(first.status).toBe(201)
    expect(first.body.added.map((g: any) => [g.name, g.kind, g.fromCarePlan])).toEqual([['Walk to the mailbox daily', 'goal', true], ['Eat two full meals', 'goal', true]])
    const again = await json(owner()(`/api/visit-items/goals/${ids.pat}/from-care-plan`, { method: 'POST' }))
    expect([again.status, again.body.added.length]).toEqual([200, 0])
    const onVisit = ((await json(as('ann')(`/api/visit-items/visit/${ids.visit}`))).body.data as any[]).filter((i) => i.kind === 'goal').map((i) => i.name)
    expect(onVisit).toEqual(['Walk to the mailbox daily', 'Eat two full meals'])
  })

  test('Visit Documentation shows the visit’s answers and its items', async () => {
    const day = agencyDay('America/Chicago')
    // the visit Visit Documentation lists comes from the schedule
    await ins(t.schema.schedules, { companyId, clientId: ids.pat, caregiverId: ids.ann, scheduleType: 'one-time', date: day, startTime: new Date(Date.now() - 2 * 3_600_000), endTime: new Date(Date.now() + 3_600_000), isActive: true })
    const from = agencyDay('America/Chicago', -2), to = agencyDay('America/Chicago', 2)
    const r = await json(owner()(`/api/visit-docs/clients/${ids.pat}?from=${from}&to=${to}`))
    expect(r.status).toBe(200)
    const withPunch = (r.body.visits as any[]).find((v) => v.punch?.timeEntryId === ids.visit)
    expect(withPunch).toBeTruthy()
    expect(withPunch.punch.answers).toEqual([expect.objectContaining({ prompt: 'Temperature (°F)?', answer: '101.2', flagged: true })])
    expect(withPunch.punch.items.map((i: any) => i.name)).toEqual(expect.arrayContaining(['Check skin for redness', 'Walk to the mailbox daily']))
  })
})
