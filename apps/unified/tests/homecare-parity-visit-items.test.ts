// Home care parity row 4 (docs/parity/homecare-daily-care-wording.md, "Service Tasks sub-sections: Forms, Interventions, Goals",
// "Tasks (general and client-specific)"): forms, interventions and goals inside a visit, tasks for every visit, required ones
// that hold the clock-out, and the agency's visit-note rule. Behind care_visit_items.
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { isSettled } from '../server/crm/homecare/core/visitItems.ts'

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
const ON = ['contacts', 'scheduling', 'team', 'care_visit_items']
const add = async (b: any) => json(await as('owner')('/api/visit-items', { method: 'POST', json: b }))
const open = async (clientId = ids.pat) => (await json(await as('ann')('/api/time-entries/clock-in', { method: 'POST', json: { clientId, latitude: 44.8, longitude: -91.5 } }))).body.id as string
const record = async (visit: string, item: string, b: any, who = 'ann') => json(await as(who)(`/api/visit-items/visit/${visit}/${item}`, { method: 'PUT', json: b }))
const clockOut = async (visit: string, b: any = { notes: 'fine' }) => json(await as('ann')(`/api/time-entries/${visit}/clock-out`, { method: 'POST', json: b }))
const view = async (visit: string, who = 'ann') => (await json(await as(who)(`/api/visit-items/visit/${visit}`))).body.data as any[]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  for (const who of ['ann', 'bob']) {
    ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId })).id
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
  }
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  await ins(t.schema.clientAssignments, { companyId, clientId: ids.pat, caregiverId: ids.ann, assignmentDate: '2026-10-01', status: 'active' })
  ids.sam = (await ins(t.schema.clients, { companyId, firstName: 'Sam', lastName: 'Other', isActive: true, isPrivatePay: true })).id
  ids.tpl = (await ins(t.schema.formTemplates, { companyId, name: 'Fall check', category: 'general', isActive: true, requiresSignature: false,
    fields: [{ id: 'steady', type: 'radio', label: 'Steady on feet?', options: ['yes', 'no'], required: true }, { id: 'notes', type: 'textarea', label: 'Notes' }] })).id
  ids.sigTpl = (await ins(t.schema.formTemplates, { companyId, name: 'Consent', category: 'consent', isActive: true, requiresSignature: true, fields: [] })).id
  await setFeatures(ON)
}, 90_000)
beforeEach(async () => {
  await t.db.update(t.schema.timeEntries).set({ endTime: sql`start_time + INTERVAL '1 minute'`, isComplete: true } as any).where(isNull(t.schema.timeEntries.endTime))
  await t.db.delete(t.schema.visitItem)
  await as('owner')('/api/visit-items/settings', { method: 'PUT', json: { noteRequired: false } })
})

describe('home care parity row 4 — the rules', () => {
  test('a required item is settled by done, skipped or refused — and by nothing else', () => {
    expect(isSettled({ status: 'done' })).toBe(true)
    expect(isSettled({ status: 'skipped' })).toBe(true)
    expect(isSettled({ status: 'refused' })).toBe(true)
    expect(isSettled({ status: null })).toBe(false)
    expect(isSettled(undefined)).toBe(false)
  })
})

describe('home care parity row 4 — the office sets items up', () => {
  test('forms, interventions, goals and tasks for every visit can be added; bad ones are refused in plain words; a caregiver cannot', async () => {
    const goal = await add({ kind: 'goal', clientId: ids.pat, name: 'Walk to the mailbox unaided' })
    expect(goal.status).toBe(201)
    const interv = await add({ kind: 'intervention', clientId: ids.pat, name: 'Walk the hall with the walker twice', goalId: goal.body.id, required: true })
    expect(interv.status).toBe(201)
    expect(interv.body.goalId).toBe(goal.body.id)
    const form = await add({ kind: 'form', clientId: ids.pat, formTemplateId: ids.tpl })
    expect(form.body.name).toBe('Fall check') // named after the form when no name is given
    const general = await add({ kind: 'general_task', name: 'Wash hands on arrival', required: true })
    expect(general.body.clientId).toBeNull()
    expect((await add({ kind: 'goal', name: 'No client' })).body.fields.clientId).toBeTruthy()
    expect((await add({ kind: 'form', clientId: ids.pat, formTemplateId: 'nope' })).body.fields.formTemplateId).toBeTruthy()
    expect((await add({ kind: 'intervention', clientId: ids.sam, name: 'x', goalId: goal.body.id })).body.fields.goalId).toBeTruthy() // another client's goal
    expect((await add({ kind: 'thing', name: 'x' })).status).toBe(400)
    expect((await add({ kind: 'general_task', name: '' })).body.fields.name).toBeTruthy()
    expect((await json(await as('ann')('/api/visit-items', { method: 'POST', json: { kind: 'general_task', name: 'x' } }))).status).toBe(403)
    expect((await json(await as('ann')('/api/visit-items'))).status).toBe(403)
    const edited = await json(await as('owner')(`/api/visit-items/${general.body.id}`, { method: 'PUT', json: { name: 'Wash and dry hands', required: false } }))
    expect(edited.body).toMatchObject({ name: 'Wash and dry hands', required: false })
    expect((await as('owner')(`/api/visit-items/${general.body.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  test('with the feature off the screens are closed (403) and the clock-out asks nothing', async () => {
    await add({ kind: 'general_task', name: 'Needed', required: true })
    await setFeatures(['contacts', 'scheduling', 'team'])
    expect((await as('owner')('/api/visit-items')).status).toBe(403)
    const visit = await open()
    expect((await clockOut(visit)).status).toBe(200)
    await setFeatures(ON)
  })
})

describe('home care parity row 4 — in the visit', () => {
  test('the caregiver sees this client\'s items and the every-visit ones, in order: forms, interventions, goals, tasks; not another client\'s or a switched-off one', async () => {
    const goal = (await add({ kind: 'goal', clientId: ids.pat, name: 'Goal A' })).body
    await add({ kind: 'general_task', name: 'Task for all' })
    await add({ kind: 'intervention', clientId: ids.pat, name: 'Intervention A', goalId: goal.id })
    await add({ kind: 'form', clientId: ids.pat, formTemplateId: ids.tpl })
    await add({ kind: 'goal', clientId: ids.sam, name: "Sam's goal" })
    await add({ kind: 'general_task', name: 'Off task', isActive: false })
    const v = await open()
    const items = await view(v)
    expect(items.map((i) => i.name)).toEqual(['Fall check', 'Intervention A', 'Goal A', 'Task for all'])
    expect(items.every((i) => i.status === null)).toBe(true)
    expect((await json(await as('bob')(`/api/visit-items/visit/${v}`))).status).toBe(403) // not Bob's shift
    expect((await json(await as('owner')(`/api/visit-items/visit/${v}`))).status).toBe(200)
  })

  test('done, skipped and refused are recorded; a refusal always needs its reason; a goal needs how it went', async () => {
    const goal = (await add({ kind: 'goal', clientId: ids.pat, name: 'Goal A' })).body
    const task = (await add({ kind: 'general_task', name: 'Sanitise table' })).body
    const must = (await add({ kind: 'general_task', name: 'Check smoke alarm', required: true })).body
    const v = await open()
    expect((await record(v, task.id, { status: 'done' })).status).toBe(200)
    expect((await record(v, task.id, { status: 'refused' })).body.code).toBe('refusal_needs_reason')
    expect((await record(v, task.id, { status: 'refused', note: 'Client said no' })).status).toBe(200)
    expect((await record(v, must.id, { status: 'skipped' })).body.code).toBe('skip_needs_reason')
    expect((await record(v, must.id, { status: 'skipped', note: 'Battery out of stock' })).status).toBe(200)
    expect((await record(v, goal.id, { status: 'done' })).body.code).toBe('rating_required')
    expect((await record(v, goal.id, { status: 'done', rating: 'great' })).status).toBe(400)
    const ok = await record(v, goal.id, { status: 'done', rating: 'progress', note: 'Walked to the gate' })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ status: 'done', rating: 'progress', note: 'Walked to the gate' })
    expect((await record(v, 'nope', { status: 'done' })).status).toBe(404)
    expect((await record(v, task.id, { status: 'maybe' })).status).toBe(400)
    expect((await record(v, task.id, { status: 'done' }, 'bob')).status).toBe(403)
    const other = (await add({ kind: 'general_task', name: 'x' })).body // an item for Sam only
    await t.db.update(t.schema.visitItem).set({ clientId: ids.sam } as any).where(eq(t.schema.visitItem.id, other.id))
    expect((await record(v, other.id, { status: 'done' })).status).toBe(404)
    const now = await view(v)
    expect(now.find((i) => i.id === task.id)).toMatchObject({ status: 'refused', note: 'Client said no' })
  })

  test('a form is filled in through the visit: required answers, a signature when the form needs one; it is kept as a form about the client', async () => {
    const form = (await add({ kind: 'form', clientId: ids.pat, formTemplateId: ids.tpl })).body
    const sig = (await add({ kind: 'form', clientId: ids.pat, formTemplateId: ids.sigTpl })).body
    const v = await open()
    expect((await record(v, form.id, { status: 'done' })).body.code).toBe('use_form')
    const post = (item: string, b: any) => json(as('ann')(`/api/visit-items/visit/${v}/${item}/form`, { method: 'POST', json: b }) as any)
    const missing = await json(await as('ann')(`/api/visit-items/visit/${v}/${form.id}/form`, { method: 'POST', json: { data: { notes: 'x' } } }))
    expect(missing.status).toBe(400)
    expect(missing.body.error).toContain('Steady on feet?')
    const ok = await json(await as('ann')(`/api/visit-items/visit/${v}/${form.id}/form`, { method: 'POST', json: { data: { steady: 'yes' } } }))
    expect(ok.status).toBe(201)
    expect(ok.body.status).toBe('done')
    const [saved] = await t.db.select().from(t.schema.formSubmissions).where(eq(t.schema.formSubmissions.id, ok.body.formSubmissionId))
    expect(saved).toMatchObject({ templateName: 'Fall check', clientId: ids.pat, submittedById: ids.ann, status: 'submitted' })
    expect((await view(v)).find((i) => i.id === form.id)).toMatchObject({ status: 'done', formSubmissionId: ok.body.formSubmissionId })
    const noSig = await json(await as('ann')(`/api/visit-items/visit/${v}/${sig.id}/form`, { method: 'POST', json: { data: {} } }))
    expect(noSig.body.code).toBe('signature_required')
    const signed = await json(await as('ann')(`/api/visit-items/visit/${v}/${sig.id}/form`, { method: 'POST', json: { data: {}, signature: 'data:image/png;base64,AAAA' } }))
    expect(signed.status).toBe(201)
    void post
  })

  test('a done time saved on the phone without signal is stamped with the time it was done', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: [...ON, 'care_offline_saves'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    const task = (await add({ kind: 'general_task', name: 'Sanitise table' })).body
    const v = await open()
    const tenAgo = new Date(Date.now() - 10 * 60_000)
    expect((await record(v, task.id, { status: 'done', savedAt: tenAgo.toISOString() })).status).toBe(200)
    const [log] = await t.db.select().from(t.schema.visitItemLog).where(eq(t.schema.visitItemLog.itemId, task.id))
    expect(Math.abs(new Date(log.completedAt).getTime() - tenAgo.getTime())).toBeLessThan(2000)
    expect((await record(v, task.id, { status: 'done', savedAt: new Date(Date.now() + 3_600_000).toISOString() })).body.code).toBe('bad_saved_time')
    await setFeatures(ON)
  })

  test('the office reads how a goal went, visit by visit', async () => {
    const goal = (await add({ kind: 'goal', clientId: ids.pat, name: 'Goal A' })).body
    const v = await open()
    await record(v, goal.id, { status: 'done', rating: 'declined', note: 'Tired' })
    const r = await json(await as('owner')(`/api/visit-items/goals/${ids.pat}`))
    expect(r.body.data[0]).toMatchObject({ goal: 'Goal A', rating: 'declined', note: 'Tired', caregiverFirst: 'Ann' })
    expect((await json(await as('ann')(`/api/visit-items/goals/${ids.pat}`))).status).toBe(403)
  })
})

describe('home care parity row 4 — at clock-out', () => {
  test('a required item holds a live clock-out (409, naming it); done, or skipped with a reason, lets it go', async () => {
    const must = (await add({ kind: 'general_task', name: 'Wash hands', required: true })).body
    const form = (await add({ kind: 'form', clientId: ids.pat, formTemplateId: ids.tpl, required: true })).body
    const v = await open()
    const held = await clockOut(v)
    expect(held.status).toBe(409)
    expect(held.body.code).toBe('required_items_pending')
    expect(held.body.error).toContain('Wash hands')
    expect(held.body.error).toContain('Fall check')
    expect(Object.keys(held.body.fields).sort()).toEqual([must.id, form.id].sort())
    await record(v, must.id, { status: 'done' })
    expect((await clockOut(v)).body.code).toBe('required_items_pending')
    await record(v, form.id, { status: 'skipped', note: 'Client asleep' })
    const out = await clockOut(v)
    expect(out.status).toBe(200)
  })

  test('an optional item never holds the clock-out', async () => {
    await add({ kind: 'general_task', name: 'Optional' })
    const v = await open()
    expect((await clockOut(v)).status).toBe(200)
  })

  test('a clock-out saved on the phone with a required item open is recorded and flagged for the office, not refused', async () => {
    await add({ kind: 'general_task', name: 'Wash hands', required: true })
    const v = await open()
    const out = await clockOut(v, { notes: 'fine', offlineAt: new Date(Date.now() + 1000).toISOString() })
    expect(out.status).toBe(200)
    expect(out.body.needsApproval).toBe(true)
    expect(out.body.approvalReason).toContain('Required items not recorded: Wash hands')
  })

  test('the agency can require a visit note: a live clock-out without one is refused, with one it goes; off by default', async () => {
    const v1 = await open()
    expect((await clockOut(v1, {})).status).toBe(200) // no rule yet
    expect((await json(await as('ann')('/api/visit-items/settings', { method: 'PUT', json: { noteRequired: true } }))).status).toBe(403)
    const bad = await json(await as('owner')('/api/visit-items/settings', { method: 'PUT', json: { noteRequired: 'yes' } }))
    expect(bad.status).toBe(400)
    expect((await json(await as('owner')('/api/visit-items/settings', { method: 'PUT', json: { noteRequired: true } }))).body.noteRequired).toBe(true)
    expect((await json(await as('ann')('/api/visit-items/settings'))).body.noteRequired).toBe(true)
    const v2 = await open()
    const refused = await clockOut(v2, { notes: '   ' })
    expect(refused.status).toBe(400)
    expect(refused.body.code).toBe('note_required')
    expect((await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, v2)))[0].endTime).toBeNull()
    expect((await clockOut(v2, { notes: 'Bathed, lunch' })).status).toBe(200)
  })

  test('a clock-out saved offline without a note, under the note rule, is recorded and flagged', async () => {
    await as('owner')('/api/visit-items/settings', { method: 'PUT', json: { noteRequired: true } })
    const v = await open()
    const out = await clockOut(v, { offlineAt: new Date(Date.now() + 1000).toISOString() })
    expect(out.status).toBe(200)
    expect(out.body.approvalReason).toContain('No visit note')
  })
})
