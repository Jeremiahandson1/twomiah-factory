// Project templates (brief item 6, contractors): save a project as a template — its schedule (phases, milestones, tasks as
// days from the start) and its punch list — and start the next project from one, on the new project's own dates.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY, getAdvertisableFeaturesForTemplate } from '@twomiah/tenant-backend'

const json = async (r: Response) => (await r.json()) as any
const ON = ['contacts', 'projects', 'gantt_charts', 'punch_lists', 'project_templates']
const day = (s: string) => new Date(`${s}T00:00:00.000Z`)
const iso = (d: any) => new Date(d).toISOString().slice(0, 10)

async function boot(vertical = 'contractor', features = ON) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, s.company.id))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  const seat = async (role: string) => {
    await ins(t.schema.user, { companyId: s.company.id, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
    return as(await login(`${role}@test.example`, 'Correct-horse-1'))
  }
  const companyId = s.company.id as string
  const customer = await ins(t.schema.contact, { companyId, type: 'client', name: 'Ruiz Family' })
  // A finished kitchen: a phase with two tasks and a milestone, a lone task, and two snags on the punch list.
  const kitchen = await ins(t.schema.project, { companyId, number: 'PRJ-0001', name: 'Kitchen — Ruiz', type: 'renovation', contactId: customer.id, startDate: day('2026-03-02'), budget: '50000' })
  const phase = await ins(t.schema.projectTask, { companyId, projectId: kitchen.id, name: 'Demolition', startDate: day('2026-03-02'), endDate: day('2026-03-06'), progress: 100, status: 'done' })
  await ins(t.schema.projectTask, { companyId, projectId: kitchen.id, parentId: phase.id, name: 'Pull cabinets', startDate: day('2026-03-02'), endDate: day('2026-03-04') })
  await ins(t.schema.projectTask, { companyId, projectId: kitchen.id, parentId: phase.id, name: 'Haul debris', startDate: day('2026-03-05'), endDate: day('2026-03-06') })
  await ins(t.schema.projectTask, { companyId, projectId: kitchen.id, name: 'Rough-in inspection', startDate: day('2026-03-16'), endDate: day('2026-03-16') })
  await ins(t.schema.punchListItem, { companyId, projectId: kitchen.id, number: 'PL-001', description: 'Touch up paint at the pantry door', location: 'Pantry', priority: 'low', status: 'closed' })
  await ins(t.schema.punchListItem, { companyId, projectId: kitchen.id, number: 'PL-002', description: 'Caulk the backsplash edge', priority: 'high' })
  return { t, ins, owner, seat, companyId, customer, kitchen }
}

describe('save a project as a template, start one from it', () => {
  test('the template keeps the schedule as days from the start and the starter punch list — not people, progress or money', async () => {
    const x = await boot()
    const saved = await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } })
    expect(saved.status).toBe(201)
    const made = await json(saved)
    expect(made).toMatchObject({ name: 'Kitchen remodel', taskCount: 4, punchItemCount: 2, type: 'renovation' })

    const t = await json(await x.owner(`/api/project-templates/${made.id}`))
    const byName = Object.fromEntries(t.tasks.map((k: any) => [k.name, k]))
    expect(byName['Demolition']).toMatchObject({ offsetDays: 0, spanDays: 4, milestone: false, parentId: null })
    expect(byName['Pull cabinets']).toMatchObject({ offsetDays: 0, spanDays: 2, parentId: byName['Demolition'].id })
    expect(byName['Haul debris']).toMatchObject({ offsetDays: 3, spanDays: 1, parentId: byName['Demolition'].id })
    expect(byName['Rough-in inspection']).toMatchObject({ offsetDays: 14, spanDays: 0, milestone: true })
    expect(t.punchItems.map((p: any) => [p.description, p.priority])).toEqual([['Touch up paint at the pantry door', 'low'], ['Caulk the backsplash edge', 'high']])
    // nothing about the first job's client, money or progress is in it
    expect(JSON.stringify(t)).not.toMatch(/Ruiz|50000|progress|contactId|budget/)

    const list = await json(await x.owner('/api/project-templates'))
    expect(list.data.map((r: any) => [r.name, r.taskCount, r.punchItemCount])).toEqual([['Kitchen remodel', 4, 2]])
  }, 90_000)

  test('starting from it makes a numbered project with the schedule on the new dates and a fresh punch list', async () => {
    const x = await boot()
    const tpl = await json(await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } }))
    const other = await x.ins(x.t.schema.contact, { companyId: x.companyId, type: 'client', name: 'Okafor' })
    const r = await x.owner(`/api/project-templates/${tpl.id}/start`, { method: 'POST', json: { name: 'Kitchen — Okafor', contactId: other.id, startDate: '2026-09-07' } })
    expect(r.status).toBe(201)
    const p = await json(r)
    expect(p).toMatchObject({ name: 'Kitchen — Okafor', number: 'PRJ-0002', type: 'renovation', contactId: other.id, copied: { tasks: 4, punchItems: 2 }, leftOut: [] })

    const tasks = (await x.t.db.select().from(x.t.schema.projectTask)).filter((k: any) => k.projectId === p.id)
    const byName = Object.fromEntries(tasks.map((k: any) => [k.name, k]))
    expect([iso(byName['Demolition'].startDate), iso(byName['Demolition'].endDate)]).toEqual(['2026-09-07', '2026-09-11'])
    expect(iso(byName['Haul debris'].startDate)).toBe('2026-09-10')
    expect(iso(byName['Rough-in inspection'].startDate)).toBe('2026-09-21')
    expect(byName['Pull cabinets'].parentId).toBe(byName['Demolition'].id)
    // none of the first project's progress came with them
    expect(tasks.every((k: any) => k.progress === 0 && k.status === 'not_started')).toBe(true)

    const punch = (await x.t.db.select().from(x.t.schema.punchListItem)).filter((k: any) => k.projectId === p.id)
    expect(punch.map((k: any) => [k.number, k.description, k.status]).sort()).toEqual([['PL-001', 'Touch up paint at the pantry door', 'open'], ['PL-002', 'Caulk the backsplash edge', 'open']])
    // the first project is untouched
    expect((await x.t.db.select().from(x.t.schema.punchListItem)).filter((k: any) => k.projectId === x.kitchen.id)).toHaveLength(2)
  }, 90_000)

  test('with no start date the tasks are made without dates, and the answer says so', async () => {
    const x = await boot()
    const tpl = await json(await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } }))
    const p = await json(await x.owner(`/api/project-templates/${tpl.id}/start`, { method: 'POST', json: { name: 'Kitchen — undated' } }))
    expect(p.copied.tasks).toBe(4)
    expect(p.leftOut).toEqual(['task dates (give the project a start date to place them)'])
  }, 90_000)

  test('where Gantt Charts and Punch Lists are off, only the project is made and the answer lists what was left out', async () => {
    // The business has templates but neither the schedule nor punch lists switched on (set before the first request: the
    // feature list is cached for a few seconds).
    const x = await boot('contractor', ['contacts', 'projects', 'project_templates'])
    const tpl = await x.ins(x.t.schema.projectTemplate, { companyId: x.companyId, name: 'Kitchen remodel' })
    await x.ins(x.t.schema.projectTemplateTask, { companyId: x.companyId, templateId: tpl.id, name: 'Demolition', offsetDays: 0, spanDays: 4 })
    await x.ins(x.t.schema.projectTemplatePunchItem, { companyId: x.companyId, templateId: tpl.id, description: 'Caulk the backsplash edge' })
    const r = await x.owner(`/api/project-templates/${tpl.id}/start`, { method: 'POST', json: { name: 'Bare', startDate: '2026-09-07' } })
    expect(r.status).toBe(201)
    const p = await json(r)
    expect(p.copied).toEqual({ tasks: 0, punchItems: 0 })
    expect(p.leftOut).toEqual(['schedule tasks (Gantt Charts is off)', 'starter punch list (Punch Lists is off, or you cannot create punch items)'])
    expect((await x.t.db.select().from(x.t.schema.projectTask)).filter((k: any) => k.projectId === p.id)).toHaveLength(0)
  }, 90_000)

  test('a second template with the same name is refused in words; rename and delete work', async () => {
    const x = await boot()
    const a = await json(await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } }))
    const dup = await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } })
    expect(dup.status).toBe(409)
    expect((await json(dup)).error).toContain('already have a template called "Kitchen remodel"')
    const renamed = await x.owner(`/api/project-templates/${a.id}`, { method: 'PUT', json: { name: 'Full kitchen' } })
    expect((await json(renamed)).name).toBe('Full kitchen')
    expect((await x.owner(`/api/project-templates/${a.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await x.owner(`/api/project-templates/${a.id}`)).status).toBe(404)
    // deleting a template never touches the project it came from
    expect((await x.t.db.select().from(x.t.schema.projectTask)).length).toBe(4)
  }, 90_000)
})

describe('who may, and where', () => {
  test('a seat without the permission is refused by the server for each action', async () => {
    const x = await boot()
    const tpl = await json(await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } }))
    const viewer = await x.seat('viewer')
    expect((await viewer('/api/project-templates')).status).toBe(200)                     // reads
    expect((await viewer('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Sneaky' } })).status).toBe(403)
    expect((await viewer(`/api/project-templates/${tpl.id}/start`, { method: 'POST', json: { name: 'Sneaky' } })).status).toBe(403)
    expect((await viewer(`/api/project-templates/${tpl.id}`, { method: 'DELETE' })).status).toBe(403)
    const field = await x.seat('field')
    expect((await field(`/api/project-templates/${tpl.id}/start`, { method: 'POST', json: { name: 'Sneaky' } })).status).toBe(403)
  }, 90_000)

  test("one business's template is not another's", async () => {
    const x = await boot()
    const tpl = await json(await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } }))
    const y = await boot()   // another business on its own server — its owner cannot name x's template id
    expect((await y.owner(`/api/project-templates/${tpl.id}`)).status).toBe(404)
    expect((await y.owner(`/api/project-templates/${tpl.id}/start`, { method: 'POST', json: { name: 'x' } })).status).toBe(404)
  }, 90_000)

  test('with the feature off nothing answers', async () => {
    const x = await boot('contractor', ['contacts', 'projects', 'gantt_charts', 'punch_lists'])
    for (const [m, p] of [['GET', '/api/project-templates'], ['POST', '/api/project-templates/from-project'], ['POST', '/api/project-templates/x/start']] as const) {
      const r = await x.owner(p, { method: m, ...(m === 'POST' ? { json: { projectId: x.kitchen.id, name: 'x' } } : {}) })
      expect([p, r.status, (await json(r)).code]).toEqual([p, 403, 'FEATURE_NOT_ENABLED'])
    }
    expect(await x.t.db.select().from(x.t.schema.projectTemplate)).toHaveLength(0)
  }, 90_000)

  test('it is registered not ready (hidden) and offered to the contractor only', () => {
    const def = FEATURE_REGISTRY.find((f: any) => f.id === 'project_templates')
    expect(def?.hidden).toBe(true)
    expect(def?.templates).toEqual(['crm'])
    for (const template of ['crm-fieldservice', 'crm-landscaping', 'crm-basic', 'crm-roof', 'crm-rv']) {
      expect(getAdvertisableFeaturesForTemplate(template).some((f: any) => f.id === 'project_templates')).toBe(false)
    }
    // hidden: not advertised to the contractor either until the owner says it is ready
    expect(getAdvertisableFeaturesForTemplate('crm').some((f: any) => f.id === 'project_templates')).toBe(false)
  })
})
