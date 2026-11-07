// Contractor parity row 7 (part b) — a project template also keeps the budget, the selections (with their shared allowances) and
// the schedule's task links; each part ticked on saving and on starting (Buildertrend / JobTread templates; template_parts, not
// ready). Fails without the change: a template kept only the tasks and the punch list, and dropped the links between tasks.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'

const json = async (r: Response) => (await r.json()) as any
const ON = ['contacts', 'projects', 'gantt_charts', 'punch_lists', 'project_templates', 'selections', 'shared_allowances', 'template_parts', 'job_costing', 'job_budgets']
const day = (s: string) => new Date(`${s}T00:00:00.000Z`)
const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null)

async function boot(features = ON) {
  const t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  const companyId = s.company.id as string
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const tok = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  const owner = (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const customer = await ins(t.schema.contact, { companyId, type: 'client', name: 'Ruiz Family' })
  const kitchen = await ins(t.schema.project, { companyId, number: 'PRJ-0001', name: 'Kitchen — Ruiz', contactId: customer.id, startDate: day('2026-03-02') })
  const demo = await ins(t.schema.projectTask, { companyId, projectId: kitchen.id, name: 'Demolition', startDate: day('2026-03-02'), endDate: day('2026-03-06') })
  const rough = await ins(t.schema.projectTask, { companyId, projectId: kitchen.id, name: 'Rough-in', startDate: day('2026-03-09'), endDate: day('2026-03-13') })
  await ins(t.schema.taskDependency, { companyId, projectId: kitchen.id, predecessorId: demo.id, successorId: rough.id, type: 'finish_to_start', lagDays: 2 })
  await ins(t.schema.projectBudgetLine, { companyId, projectId: kitchen.id, costCode: '02-Demo', estimatedCost: '800', estimatedPrice: '1000' })
  await ins(t.schema.projectBudgetLine, { companyId, projectId: kitchen.id, costCode: '15-Plumbing', estimatedCost: '2400', estimatedPrice: '3200' })
  const cat = await ins(t.schema.selectionCategory, { companyId, name: 'Plumbing Fixtures' })
  const allowance = await ins(t.schema.projectAllowance, { companyId, projectId: kitchen.id, name: 'Plumbing fixtures', amount: '4000', costCode: '15-Plumbing' })
  const opt = await ins(t.schema.selectionOption, { companyId, categoryId: cat.id, name: 'Faucet', price: '900' })
  // chosen and approved on the first job: the template keeps the selection to be made, not the choice
  await ins(t.schema.projectSelection, { companyId, projectId: kitchen.id, categoryId: cat.id, allowanceId: allowance.id, name: 'Faucet', location: 'Sink', quantity: 1, allowance: '0', status: 'approved', selectedOptionId: opt.id, priceDifference: '0', dueDate: day('2026-03-12') })
  await ins(t.schema.projectSelection, { companyId, projectId: kitchen.id, categoryId: cat.id, name: 'Cabinet pulls', quantity: 24, unit: 'each', allowance: '360', status: 'pending' })
  return { t, ins, owner, companyId, kitchen }
}

describe('template parts', () => {
  test('is registered, not ready, and the general contractor’s', () => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'template_parts')
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm']])
  })

  test('saved: the budget, the selections to be made with their shared allowance, and the task link with its lag', async () => {
    const x = await boot()
    const saved = await json(await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } }))
    expect(saved).toMatchObject({ taskCount: 2, budgetLineCount: 2, selectionCount: 2, allowanceCount: 1, linkCount: 1 })
    const t = await json(await x.owner(`/api/project-templates/${saved.id}`))
    expect(t.budgetLines.map((l: any) => [l.costCode, Number(l.estimatedCost), Number(l.estimatedPrice)])).toEqual([['02-Demo', 800, 1000], ['15-Plumbing', 2400, 3200]])
    expect(t.allowances.map((a: any) => [a.name, Number(a.amount), a.costCode])).toEqual([['Plumbing fixtures', 4000, '15-Plumbing']])
    const faucet = t.selections.find((s: any) => s.name === 'Faucet')
    expect(faucet).toMatchObject({ location: 'Sink', allowanceId: t.allowances[0].id, dueOffsetDays: 10 })
    expect(JSON.stringify(t.selections)).not.toMatch(/selectedOption|approved|priceDifference/)
    const byId = Object.fromEntries(t.tasks.map((k: any) => [k.id, k.name]))
    expect(t.links.map((l: any) => [byId[l.predecessorId], byId[l.successorId], l.lagDays])).toEqual([['Demolition', 'Rough-in', 2]])
    const list = (await json(await x.owner('/api/project-templates'))).data
    expect(list[0]).toMatchObject({ budgetLineCount: 2, selectionCount: 2, linkCount: 1 })
  }, 90_000)

  test('saving with parts unticked keeps only what was ticked', async () => {
    const x = await boot()
    const saved = await json(await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Schedule only', includeBudget: false, includeSelections: false, includeLinks: false } }))
    expect(saved).toMatchObject({ taskCount: 2, budgetLineCount: 0, selectionCount: 0, allowanceCount: 0, linkCount: 0 })
  }, 90_000)

  test('started: every part on the new project, on its own dates; unticked parts are not brought in, and not reported as left out', async () => {
    const x = await boot()
    const saved = await json(await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } }))
    const r = await x.owner(`/api/project-templates/${saved.id}/start`, { method: 'POST', json: { name: 'Kitchen — Okafor', startDate: '2026-06-01' } })
    expect(r.status).toBe(201)
    const made = await json(r)
    expect(made.copied).toEqual({ tasks: 2, punchItems: 0, links: 1, budgetLines: 2, selections: 2, allowances: 1 })
    expect(made.leftOut).toEqual([])
    const S = x.t.schema
    const deps = await x.t.db.select().from(S.taskDependency).where(eq(S.taskDependency.projectId, made.id)) as any[]
    const tasks = await x.t.db.select().from(S.projectTask).where(eq(S.projectTask.projectId, made.id)) as any[]
    const name = (id: string) => tasks.find((k) => k.id === id)?.name
    expect(deps.map((dd) => [name(dd.predecessorId), name(dd.successorId), dd.lagDays])).toEqual([['Demolition', 'Rough-in', 2]])
    const budget = await json(await x.owner(`/api/job-costing/budget/${made.id}`))
    expect([budget.totalCost, budget.totalPrice]).toEqual([3200, 4200])
    const sels = await x.t.db.select().from(S.projectSelection).where(eq(S.projectSelection.projectId, made.id)) as any[]
    const [allow] = await x.t.db.select().from(S.projectAllowance).where(eq(S.projectAllowance.projectId, made.id)) as any[]
    const faucet = sels.find((s) => s.name === 'Faucet')
    expect([faucet.status, faucet.selectedOptionId, faucet.allowanceId, iso(faucet.dueDate)]).toEqual(['pending', null, allow.id, '2026-06-11'])
    expect(sels.find((s) => s.name === 'Cabinet pulls')).toMatchObject({ quantity: 24, allowance: '360.00', allowanceId: null })

    const only = await json(await x.owner(`/api/project-templates/${saved.id}/start`, { method: 'POST', json: { name: 'Schedule only', startDate: '2026-07-01', import: { budget: false, selections: false } } }))
    expect(only.copied).toMatchObject({ tasks: 2, links: 1, budgetLines: 0, selections: 0 })
    expect(only.leftOut).toEqual([])
  }, 90_000)

  test('started where Shared allowances is off: the selections come in on their own allowances, and the answer says so', async () => {
    const x = await boot()
    const saved = await json(await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } }))
    await x.t.db.update(x.t.schema.company).set({ enabledFeatures: ON.filter((f) => f !== 'shared_allowances') } as any).where(eq(x.t.schema.company.id, x.companyId))
    ;(x.t as any).services.features.forgetFeatures()
    const made = await json(await x.owner(`/api/project-templates/${saved.id}/start`, { method: 'POST', json: { name: 'Kitchen — Okafor', startDate: '2026-06-01' } }))
    expect(made.copied).toMatchObject({ selections: 2, allowances: 0 })
    expect(made.leftOut.join(' ')).toMatch(/shared allowances/)
  }, 90_000)

  test('off: the template is as it was — tasks and punch list only, no links', async () => {
    const x = await boot(ON.filter((f) => f !== 'template_parts'))
    const saved = await json(await x.owner('/api/project-templates/from-project', { method: 'POST', json: { projectId: x.kitchen.id, name: 'Kitchen remodel' } }))
    expect(saved.budgetLineCount).toBeUndefined()
    const t = await json(await x.owner(`/api/project-templates/${saved.id}`))
    expect([t.budgetLines, t.selections, t.links]).toEqual([undefined, undefined, undefined])
    const made = await json(await x.owner(`/api/project-templates/${saved.id}/start`, { method: 'POST', json: { name: 'Kitchen — Okafor', startDate: '2026-06-01', import: { schedule: false } } }))
    // off, the ticks are not read: the schedule still comes in
    expect(made.copied).toEqual({ tasks: 2, punchItems: 0 })
    const deps = await x.t.db.select().from(x.t.schema.taskDependency).where(eq(x.t.schema.taskDependency.projectId, made.id)) as any[]
    expect(deps.length).toBe(0)
  }, 90_000)
})
