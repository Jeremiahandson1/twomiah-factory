// Contractor parity row 7 (part c) — links between schedule tasks on the Gantt (Buildertrend predecessors, JobTread dependencies;
// task_links, not ready): a task waits on another (after it ends, or once it starts, plus a lag); moving a task moves the tasks
// linked to it, and theirs; a loop is refused. Fails without the change: task_dependency had no route and nothing moved.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { placeLinked } from '../server/crm/projects/ganttCharts.ts'

const json = async (r: Response) => (await r.json()) as any
const ON = ['contacts', 'projects', 'gantt_charts', 'task_links']
const day = (s: string) => new Date(`${s}T00:00:00.000Z`)
const iso = (d: any) => new Date(d).toISOString().slice(0, 10)

async function boot(features = ON) {
  const t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  const companyId = s.company.id as string
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const tok = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  const owner = (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const job = await ins(t.schema.project, { companyId, number: 'PRJ-0001', name: 'Addition', startDate: day('2026-05-04') })
  const task = (name: string, a: string, b: string) => ins(t.schema.projectTask, { companyId, projectId: job.id, name, startDate: day(a), endDate: day(b) })
  const footings = await task('Footings', '2026-05-04', '2026-05-06')
  const framing = await task('Framing', '2026-05-07', '2026-05-15')
  const roofing = await task('Roofing', '2026-05-18', '2026-05-20')
  const permit = await task('Permit sign', '2026-05-04', '2026-05-04')
  const dates = async (id: string) => { const [r] = await t.db.select().from(t.schema.projectTask).where(eq(t.schema.projectTask.id, id)) as any[]; return [iso(r.startDate), iso(r.endDate)] }
  const link = (predecessorId: string, successorId: string, extra: any = {}) => owner(`/api/gantt-charts/${job.id}/links`, { method: 'POST', json: { predecessorId, successorId, ...extra } })
  return { t, owner, job, footings, framing, roofing, permit, dates, link }
}

describe('the placing', () => {
  test('after it ends, or once it starts, plus the lag; the length is kept; a task with two links waits for the later', () => {
    const T = (id: string, a: string, b: string) => ({ id, startDate: day(a), endDate: day(b) })
    const tasks = [T('a', '2026-05-04', '2026-05-06'), T('b', '2026-05-01', '2026-05-03'), T('c', '2026-05-01', '2026-05-02')]
    const fs = placeLinked(tasks, [{ predecessorId: 'a', successorId: 'b', type: 'finish_to_start', lagDays: 2 }], ['a'])
    expect(fs.map((m) => [m.id, iso(m.startDate), iso(m.endDate)])).toEqual([['b', '2026-05-09', '2026-05-11']])
    const ss = placeLinked(tasks, [{ predecessorId: 'a', successorId: 'c', type: 'start_to_start', lagDays: 1 }], ['a'])
    expect(ss.map((m) => [m.id, iso(m.startDate), iso(m.endDate)])).toEqual([['c', '2026-05-05', '2026-05-06']])
    const two = placeLinked(tasks, [{ predecessorId: 'a', successorId: 'c', type: 'finish_to_start', lagDays: 0 }, { predecessorId: 'b', successorId: 'c', type: 'finish_to_start', lagDays: 10 }], ['a'])
    expect(two.map((m) => [m.id, iso(m.startDate)])).toEqual([['c', '2026-05-14']])
  })
})

describe('task links', () => {
  test('is registered, not ready, and the general contractor’s', () => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'task_links')
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm']])
  })

  test('linked: the successor is placed by the link; moving the first task moves the chain, either way; the chart shows the links', async () => {
    const x = await boot()
    const a = await x.link(x.footings.id, x.framing.id, { lagDays: 2 })
    expect(a.status).toBe(201)
    const made = await json(a)
    // footings end 05-06; framing waits two days after: starts 05-09, keeps its nine days
    expect(made.moved.map((m: any) => m.name)).toEqual(['Framing'])
    expect(await x.dates(x.framing.id)).toEqual(['2026-05-09', '2026-05-17'])
    expect((await x.link(x.framing.id, x.roofing.id)).status).toBe(201)
    expect(await x.dates(x.roofing.id)).toEqual(['2026-05-18', '2026-05-20'])

    // the footings slip three days: framing and roofing go with them
    const slip = await json(await x.owner(`/api/gantt-charts/tasks/${x.footings.id}`, { method: 'PATCH', json: { startDate: '2026-05-07', endDate: '2026-05-09' } }))
    expect(slip.moved.map((m: any) => m.name).sort()).toEqual(['Framing', 'Roofing'])
    expect(await x.dates(x.framing.id)).toEqual(['2026-05-12', '2026-05-20'])
    expect(await x.dates(x.roofing.id)).toEqual(['2026-05-21', '2026-05-23'])
    // and pulled back a day: so do they
    await x.owner(`/api/gantt-charts/tasks/${x.footings.id}`, { method: 'PATCH', json: { startDate: '2026-05-06', endDate: '2026-05-08' } })
    expect(await x.dates(x.roofing.id)).toEqual(['2026-05-20', '2026-05-22'])
    // a task not linked stays where it is
    expect(await x.dates(x.permit.id)).toEqual(['2026-05-04', '2026-05-04'])

    const chart = (await json(await x.owner('/api/gantt-charts'))).data.find((p: any) => p.id === x.job.id)
    expect(chart.links.map((l: any) => [l.predecessorId, l.successorId, l.lagDays])).toEqual([[x.footings.id, x.framing.id, 2], [x.framing.id, x.roofing.id, 0]])
    const one = await json(await x.owner(`/api/gantt-charts/${x.job.id}`))
    expect(one.project.links.length).toBe(2)

    // removing the link frees the roofing
    const id = chart.links[1].id
    expect((await x.owner(`/api/gantt-charts/links/${id}`, { method: 'DELETE' })).status).toBe(200)
    await x.owner(`/api/gantt-charts/tasks/${x.footings.id}`, { method: 'PATCH', json: { startDate: '2026-05-04', endDate: '2026-05-06' } })
    expect(await x.dates(x.roofing.id)).toEqual(['2026-05-20', '2026-05-22'])
  }, 90_000)

  test('refused: a loop, a task on itself, the same link twice, a task on another project', async () => {
    const x = await boot()
    expect((await x.link(x.footings.id, x.framing.id)).status).toBe(201)
    expect((await x.link(x.framing.id, x.roofing.id)).status).toBe(201)
    const loop = await x.link(x.roofing.id, x.footings.id)
    expect(loop.status).toBe(400)
    expect((await json(loop)).error).toMatch(/loop/)
    expect((await x.link(x.framing.id, x.framing.id)).status).toBe(400)
    expect((await x.link(x.footings.id, x.framing.id)).status).toBe(409)
    expect((await x.link(x.footings.id, 'not-a-task')).status).toBe(400)
  }, 90_000)

  test('off: no link routes, no links on the chart, and moving a task moves only it', async () => {
    const x = await boot(['contacts', 'projects', 'gantt_charts'])
    expect((await x.link(x.footings.id, x.framing.id)).status).toBe(404)
    const chart = (await json(await x.owner('/api/gantt-charts'))).data.find((p: any) => p.id === x.job.id)
    expect('links' in chart).toBe(false)
    // a link already in the table (a template made it) does not drag anything while off
    await x.t.db.insert(x.t.schema.taskDependency).values({ companyId: (x.job as any).companyId, projectId: x.job.id, predecessorId: x.footings.id, successorId: x.framing.id } as any)
    const r = await json(await x.owner(`/api/gantt-charts/tasks/${x.footings.id}`, { method: 'PATCH', json: { startDate: '2026-05-11', endDate: '2026-05-13' } }))
    expect('moved' in r).toBe(false)
    expect(await x.dates(x.framing.id)).toEqual(['2026-05-07', '2026-05-15'])
  }, 90_000)
})
