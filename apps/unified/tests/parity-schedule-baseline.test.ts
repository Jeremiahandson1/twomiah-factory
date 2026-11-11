// Parity tier 3 (11/10, contractor): the schedule baseline — Buildertrend's baseline and "baseline vs actual". Through the real
// server as the contractor:
//   · nothing to save while a project has no tasks; saved, it lists with its task count;
//   · moved, stretched, added and removed tasks show against the plan in whole days, and the project's finish slip;
//   · another company's project is not found; switched off, closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { compareSchedules } from '../server/crm/projects/baselines.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', proj = '', frame = '', roof = '', paint = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const at = (s: string) => new Date(`${s}T00:00:00Z`)
const task = async (name: string, start: string, end: string) =>
  ((await (t.db as any).insert(t.schema.projectTask).values({ companyId, projectId: proj, name, startDate: at(start), endDate: at(end) }).returning())[0]).id

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['projects', 'gantt_charts', 'schedule_baseline'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  proj = ((await (t.db as any).insert(t.schema.project).values({ companyId, number: 'PRJ-1', name: 'Kitchen' }).returning())[0]).id
}, 120_000)

test('the comparison, in whole days', () => {
  const plan = [{ taskId: 'a', name: 'A', startDate: '2026-12-01T00:00:00Z', endDate: '2026-12-05T00:00:00Z' }, { taskId: 'b', name: 'B', startDate: '2026-12-06T00:00:00Z', endDate: '2026-12-10T00:00:00Z' }]
  const now = [{ taskId: 'a', name: 'A', startDate: '2026-12-03T00:00:00Z', endDate: '2026-12-09T00:00:00Z' }, { taskId: 'c', name: 'C', startDate: '2026-12-11T00:00:00Z', endDate: '2026-12-12T00:00:00Z' }]
  const r = compareSchedules(plan, now)
  expect(r.rows.find((x) => x.taskId === 'a')).toMatchObject({ state: 'kept', startSlip: 2, finishSlip: 4, durationChange: 2 })
  expect(r.rows.find((x) => x.taskId === 'b')?.state).toBe('removed')
  expect(r.rows.find((x) => x.taskId === 'c')?.state).toBe('new')
  expect([r.planFinish, r.nowFinish, r.projectFinishSlip]).toEqual(['2026-12-10', '2026-12-12', 2])
})

test('nothing to save while there are no tasks; saved, it lists', async () => {
  expect((await json(await call(`/api/project-baselines/${proj}`, { method: 'POST', json: {} }))).status).toBe(400)
  frame = await task('Framing', '2026-12-01', '2026-12-05')
  roof = await task('Roofing', '2026-12-06', '2026-12-10')
  paint = await task('Painting', '2026-12-11', '2026-12-14')
  const saved = await json(await call(`/api/project-baselines/${proj}`, { method: 'POST', json: {} }))
  expect([saved.status, saved.body.tasks, saved.body.name]).toEqual([201, 3, 'Baseline'])
  const list = await json(await call(`/api/project-baselines/${proj}`))
  expect(list.body.baselines.length).toBe(1)
})

test('moved, stretched, added and removed tasks against the plan', async () => {
  await t.db.update(t.schema.projectTask).set({ startDate: at('2026-12-03'), endDate: at('2026-12-08') } as any).where(eq(t.schema.projectTask.id, frame))
  await t.db.update(t.schema.projectTask).set({ startDate: at('2026-12-09'), endDate: at('2026-12-13') } as any).where(eq(t.schema.projectTask.id, roof))
  await t.db.delete(t.schema.projectTask).where(eq(t.schema.projectTask.id, paint))
  await task('Punch list', '2026-12-14', '2026-12-16')
  const r = await json(await call(`/api/project-baselines/${proj}/compare`))
  expect(r.status).toBe(200)
  const by = Object.fromEntries(r.body.rows.map((x: any) => [x.name, x]))
  expect(by.Framing).toMatchObject({ startSlip: 2, finishSlip: 3, durationChange: 1 })
  expect(by.Roofing).toMatchObject({ startSlip: 3, finishSlip: 3, durationChange: 0 })
  expect(by.Painting.state).toBe('removed')
  expect(by['Punch list'].state).toBe('new')
  expect([r.body.planFinish, r.body.nowFinish, r.body.projectFinishSlip]).toEqual(['2026-12-14', '2026-12-16', 2])
})

test("the chart's ghost bars: each task's newest planned dates", async () => {
  const r = await json(await call(`/api/project-baselines/latest/plans?projectIds=${proj}`))
  expect(r.body.plans[proj][frame]).toEqual({ start: '2026-12-01', end: '2026-12-05' })
})

test('the company-wide report: each project with a baseline, its finish slip and tasks late, early, added and taken out', async () => {
  // A second project, on plan.
  const deck = ((await (t.db as any).insert(t.schema.project).values({ companyId, number: 'PRJ-2', name: 'Deck' }).returning())[0]).id
  await (t.db as any).insert(t.schema.projectTask).values({ companyId, projectId: deck, name: 'Posts', startDate: at('2026-12-01'), endDate: at('2026-12-02') })
  await call(`/api/project-baselines/${deck}`, { method: 'POST', json: {} })
  // A third with no baseline is not in it.
  await (t.db as any).insert(t.schema.project).values({ companyId, number: 'PRJ-3', name: 'Porch' })
  const r = await json(await call('/api/project-baselines/report'))
  expect(r.status).toBe(200)
  expect(r.body.projects.map((p: any) => p.name)).toEqual(['Kitchen', 'Deck'])
  expect(r.body.projects[0]).toMatchObject({ finishSlip: 2, late: 2, early: 0, added: 1, removed: 1, planFinish: '2026-12-14', nowFinish: '2026-12-16' })
  expect(r.body.projects[1]).toMatchObject({ finishSlip: 0, late: 0, added: 0, removed: 0 })
})

test("another company's project is not found; switched off, closed", async () => {
  expect((await call('/api/project-baselines/not-a-project/compare')).status).toBe(404)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['projects', 'gantt_charts'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  expect([403, 404]).toContain((await call(`/api/project-baselines/${proj}`)).status)
})
