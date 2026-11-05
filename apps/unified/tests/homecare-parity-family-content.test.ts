// Home care parity row 6 (docs/parity/homecare-family-text.md): what a relative sees of the daily care — the tasks planned for each upcoming
// visit (only those that belong to its weekday and AM/PM), a task log for each past visit (done or not, never the caregiver's notes), the meals
// the caregiver recorded, documents the office chose to share (each relative's own switch), and vitals on their own switch. Behind care_family_content.
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { addDays, ymdIn } from '../server/crm/homecare/core/agencyTime.ts'
import { scheduledWhen } from '../server/crm/homecare/core/familyContent.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const TZ = 'America/Chicago'
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dowOf = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const ON = ['contacts', 'scheduling', 'team', 'documents', 'care_family_content']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const fam = (p: string, who = 'mary') => t.call(`/api/family-portal${p}`, { headers: { Authorization: `Bearer ${tokens[who]}` } })
const today = () => ymdIn(new Date(), TZ)
const tomorrow = () => addDays(today(), 1)

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
  await setFeatures(ON)
  const mk = async (name: string, over: any) => {
    const r = await json(await as('owner')('/api/family-portal/admin/members', { method: 'POST', json: { clientId: ids.pat, password: 'Family-pass-1', name, email: `${name.toLowerCase()}@family.example`, ...over } }))
    expect(r.status).toBe(201)
    ids[name.toLowerCase()] = r.body.id
    tokens[name.toLowerCase()] = (await json(await t.call('/api/family-portal/login', { method: 'POST', json: { email: `${name.toLowerCase()}@family.example`, password: 'Family-pass-1' } }))).body.data?.token
      ?? (await json(await t.call('/api/family-portal/login', { method: 'POST', json: { email: `${name.toLowerCase()}@family.example`, password: 'Family-pass-1' } }))).body.token
  }
  await mk('Mary', { canViewVitals: true, canViewDocuments: true, canViewMedications: true })
  await mk('Joe', { canViewVitals: false, canViewDocuments: false, canViewMedications: true })
}, 90_000)

describe('which tasks belong to an upcoming visit (pure)', () => {
  test('a visit on a date is read as that weekday and its hours', () => {
    const w = scheduledWhen('2026-11-03', '09:00', '11:00') // a Tuesday
    expect(w).toEqual({ dow: 2, startMin: 540, endMin: 660, spansDays: false })
    expect(scheduledWhen('2026-11-03', '22:00', '06:00').spansDays).toBe(true)
  })
})

describe('daily care in the family portal (care_family_content)', () => {
  beforeEach(async () => {
    await t.db.delete(t.schema.clientTaskTemplates)
    await t.db.delete(t.schema.schedules)
    await setFeatures(ON)
  })
  const task = (over: any) => ins(t.schema.clientTaskTemplates, { companyId, clientId: ids.pat, taskName: 'Task', category: 'adl', ...over })

  test('each upcoming visit lists only the tasks for its weekday and time of day', async () => {
    const dow = dowOf(tomorrow())
    const other = NAMES[(dow + 3) % 7]
    await task({ taskName: 'Bathing', daysOfWeek: NAMES[dow], timeOfDay: 'AM' })
    await task({ taskName: 'Dinner prep', timeOfDay: 'PM' })
    await task({ taskName: 'Laundry', daysOfWeek: other })
    await task({ taskName: 'Check mail' }) // any day, any time
    const made = await json(await as('owner')('/api/schedules-enhanced', { method: 'POST', json: { caregiverId: ids.ann, clientId: ids.pat, scheduleType: 'recurring', dayOfWeek: dow, startTime: '09:00', endTime: '11:00', effectiveDate: tomorrow() } }))
    expect(made.status).toBe(201)
    const r = await json(await fam('/portal/upcoming-tasks'))
    expect(r.status).toBe(200)
    const visit = r.body.data.find((v: any) => v.date === tomorrow())
    expect(visit.tasks.map((x: any) => x.taskName).sort()).toEqual(['Bathing', 'Check mail'])
  })

  test('the task log shows each past visit with done / not done and no caregiver note; a relative without the care-plan switch sees nothing', async () => {
    const bath = await task({ taskName: 'Bathing' })
    const laundry = await task({ taskName: 'Laundry' })
    const day = addDays(today(), -1)
    const visit = await ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.pat, startTime: new Date(`${day}T15:00:00Z`), endTime: new Date(`${day}T17:00:00Z`), isComplete: true, durationMinutes: 120, allottedMinutes: 120 })
    await ins(t.schema.shiftTaskCompletions, { companyId, timeEntryId: visit.id, taskTemplateId: bath.id, status: 'completed', completedAt: new Date() })
    await ins(t.schema.shiftTaskCompletions, { companyId, timeEntryId: visit.id, taskTemplateId: laundry.id, status: 'skipped', notes: 'INTERNAL: client was upset about the neighbour' })
    const r = await fam('/portal/task-log')
    const text = await r.text()
    expect(r.status).toBe(200)
    expect(text).not.toContain('INTERNAL')
    const rows = JSON.parse(text).data
    const v = rows.find((x: any) => x.timeEntryId === visit.id)
    expect(v.tasks.map((x: any) => [x.taskName, x.stateLabel])).toEqual([['Bathing', 'Done'], ['Laundry', 'Not done this visit']])
    await t.db.update(t.schema.familyMembers).set({ canViewCarePlan: false } as any).where(eq(t.schema.familyMembers.id, ids.mary))
    expect((await fam('/portal/task-log')).status).toBe(403)
    expect((await fam('/portal/upcoming-tasks')).status).toBe(403)
    await t.db.update(t.schema.familyMembers).set({ canViewCarePlan: true } as any).where(eq(t.schema.familyMembers.id, ids.mary))
  })

  test('with the feature off the new portal routes do not exist', async () => {
    await setFeatures(['contacts', 'scheduling', 'team', 'documents'])
    for (const p of ['/portal/upcoming-tasks', '/portal/task-log', '/portal/documents']) expect((await fam(p)).status).toBe(404)
  })
})

describe('meals recorded on the phone', () => {
  let visit = ''
  const put = (who: string, meal: string, b: any, v = visit) => as(who)(`/api/visit-meals/visit/${v}/${meal}`, { method: 'PUT', json: b })
  beforeAll(async () => {
    await setFeatures(ON)
    visit = (await ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.pat, startTime: new Date(Date.now() - 3 * 3600_000), endTime: new Date(Date.now() - 3600_000), isComplete: true, durationMinutes: 120, allottedMinutes: 120 })).id
  })

  test('the caregiver records a meal; saving again corrects it; the family sees it with plain labels', async () => {
    const r = await json(await put('ann', 'lunch', { description: 'Chicken soup and toast', amountEaten: 'half' }))
    expect(r.status).toBe(200)
    expect(r.body.meals).toHaveLength(1)
    expect((await json(await put('ann', 'lunch', { description: 'Chicken soup and toast', amountEaten: 'most' }))).body.meals[0].amountLabel).toBe('Ate most of it')
    await put('ann', 'snack', { description: 'Apple slices', amountEaten: 'all' })
    const log = (await json(await fam('/portal/task-log'))).body.data
    const v = log.find((x: any) => x.timeEntryId === visit)
    expect(v.meals.map((m: any) => [m.mealLabel, m.description, m.amountLabel])).toEqual(expect.arrayContaining([['Lunch', 'Chicken soup and toast', 'Ate most of it'], ['Snack', 'Apple slices', 'Ate all of it']]))
  })

  test('it says what is wrong in plain words, and refuses a caregiver who does not serve the client', async () => {
    const bad = await json(await put('ann', 'brunch', { description: 'x', amountEaten: 'all' }))
    expect(bad.status).toBe(400)
    expect(bad.body.code ?? bad.body.error?.code).toBe('bad_meal')
    expect((await json(await put('ann', 'dinner', { description: '', amountEaten: 'all' }))).status).toBe(400)
    expect((await json(await put('ann', 'dinner', { description: 'Pasta', amountEaten: 'lots' }))).status).toBe(400)
    expect((await put('bob', 'dinner', { description: 'Pasta', amountEaten: 'all' })).status).toBe(403)
    expect((await as('ann')(`/api/visit-meals/visit/${visit}/lunch`, { method: 'DELETE' })).status).toBe(200)
    expect((await json(await as('ann')(`/api/visit-meals/visit/${visit}`))).body.meals.map((m: any) => m.meal)).toEqual(['snack'])
  })

  test('with the feature off the route is refused', async () => {
    await setFeatures(['contacts', 'scheduling', 'team'])
    expect((await put('ann', 'lunch', { description: 'x', amountEaten: 'all' })).status).toBe(403)
    await setFeatures(ON)
  })
})

describe('documents shared with the family', () => {
  const upload = async (name: string, over: Record<string, string> = {}) => {
    const fd = new FormData()
    fd.append('file', new File([`%PDF-1.4 ${name}`], `${name}.pdf`, { type: 'application/pdf' }))
    fd.append('entityType', 'client'); fd.append('entityId', ids.pat); fd.append('documentName', name)
    for (const [k, v] of Object.entries(over)) fd.append(k, v)
    const r = await json(await t.call('/api/documents', { method: 'POST', body: fd, headers: { Authorization: `Bearer ${tokens.owner}` } }))
    expect(r.status).toBe(201)
    return r.body.id ?? r.body.data?.id
  }
  beforeAll(async () => { await setFeatures(ON) })

  test('only what the office shared is listed and downloadable, and only for a relative with the documents switch', async () => {
    const shared = await upload('Care agreement', { shareWithFamily: 'true' })
    const hidden = await upload('Internal note')
    const secret = await upload('Incident file', { isConfidential: 'true', shareWithFamily: 'true' }) // confidential never shares
    const list = (await json(await fam('/portal/documents'))).body.data
    expect(list.map((x: any) => x.name)).toEqual(['Care agreement'])
    expect((await fam(`/portal/documents/${shared}/download`)).status).toBe(200)
    expect((await fam(`/portal/documents/${hidden}/download`)).status).toBe(404)
    expect((await fam(`/portal/documents/${secret}/download`)).status).toBe(404)
    expect((await fam('/portal/documents', 'joe')).status).toBe(403)
    expect((await fam(`/portal/documents/${shared}/download`, 'joe')).status).toBe(403)
  })

  test('the office shares and unshares later; a confidential document cannot be shared', async () => {
    const id = await upload('Plan of care')
    const put = (docId: string, b: any) => as('owner')(`/api/documents/${docId}/sharing`, { method: 'PUT', json: b })
    expect((await put(id, { shareWithFamily: true })).status).toBe(200)
    expect((await json(await fam('/portal/documents'))).body.data.map((x: any) => x.name)).toContain('Plan of care')
    expect((await put(id, { shareWithFamily: false })).status).toBe(200)
    expect((await json(await fam('/portal/documents'))).body.data.map((x: any) => x.name)).not.toContain('Plan of care')
    expect((await put(id, { shareWithFamily: 'yes' })).status).toBe(400)
    const conf = await upload('Confidential', { isConfidential: 'true' })
    expect((await put(conf, { shareWithFamily: true })).status).toBe(400)
    expect((await as('ann')(`/api/documents/${id}/sharing`, { method: 'PUT', json: { shareWithFamily: true } })).status).toBe(403)
  })
})

describe('vitals have their own switch', () => {
  test('on: the vitals switch decides, not the medicines switch', async () => {
    await setFeatures(ON)
    expect((await fam('/portal/vitals', 'mary')).status).toBe(200)
    expect((await fam('/portal/vitals', 'joe')).status).toBe(403) // may see medicines, not vitals
    expect((await fam('/portal/medications', 'joe')).status).toBe(200)
  })
  test('off: vitals follow the medicines switch as before', async () => {
    await setFeatures(['contacts', 'scheduling', 'team', 'documents'])
    expect((await fam('/portal/vitals', 'joe')).status).toBe(200)
    await setFeatures(ON)
  })
  test('the office sets the switch per relative, and a new relative who may see medicines keeps seeing vitals', async () => {
    const r = await json(await as('owner')(`/api/family-portal/admin/members/${ids.joe}`, { method: 'PUT', json: { canViewVitals: true, canViewDocuments: true } }))
    expect(r.body).toMatchObject({ canViewVitals: true, canViewDocuments: true })
    const old = await json(await as('owner')('/api/family-portal/admin/members', { method: 'POST', json: { clientId: ids.pat, password: 'Family-pass-1', name: 'Old', email: 'old@family.example', canViewMedications: true } }))
    expect(old.body.canViewVitals).toBe(true)
  })
})
