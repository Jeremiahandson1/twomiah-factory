// Contractor parity row 7 (part a) — one allowance covering several selections, its overage raised as change orders and shown on
// the revised budget, and selection changes in WIP's contract value (Buildertrend allowances / Revised Budget, JobTread allowance
// budget lines; feature shared_allowances, not ready). Fails without the change: a selection could only price against its own
// allowance, the budget had no revised side, and a selection approved without a change order never reached WIP.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { allowanceMath } from '../server/crm/field/allowances.ts'

const json = async (r: Response) => (await r.json()) as any
const BASE = ['contacts', 'projects', 'selections', 'job_costing', 'job_budgets', 'wip_report', 'change_orders']

async function boot(features = [...BASE, 'shared_allowances']) {
  const t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  const companyId = s.company.id as string
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const tok = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  const owner = (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const customer = await ins(t.schema.contact, { companyId, type: 'client', name: 'Ruiz Family' })
  const bath = await ins(t.schema.project, { companyId, number: 'PRJ-0001', name: 'Bath — Ruiz', contactId: customer.id, status: 'active' })
  const cat = await ins(t.schema.selectionCategory, { companyId, name: 'Plumbing Fixtures' })
  const option = (name: string, price: number, cost: number) => ins(t.schema.selectionOption, { companyId, categoryId: cat.id, name, price: String(price), cost: String(cost) })
  const selection = (name: string, quantity = 1, extra: any = {}) => ins(t.schema.projectSelection, { companyId, projectId: bath.id, categoryId: cat.id, name, quantity, allowance: '0', status: 'pending', ...extra })
  const choose = async (id: string, optionId: string) => json(await owner(`/api/selections/${id}/select`, { method: 'POST', json: { optionId } }))
  const approve = async (id: string, createChangeOrder = true) => json(await owner(`/api/selections/${id}/approve`, { method: 'POST', json: { createChangeOrder } }))
  return { t, ins, owner, companyId, bath, option, selection, choose, approve }
}

describe('the arithmetic', () => {
  test('only an overage counts while any is still open; the credit comes with the last one', () => {
    const m = (status: string, price: number | null, priceDifference = 0, quantity = 1) => ({ id: status + price, status, quantity, price, cost: null, priceDifference })
    // $1,000 covering two: the first at $300 is no charge yet; the second at $400 ends $300 under, credited then.
    expect(allowanceMath(1000, [m('selected', 300), m('pending', null)]).chargeFor('selected300', 300)).toBe(0)
    expect(allowanceMath(1000, [m('approved', 300), m('selected', 400)]).chargeFor('selected400', 400)).toBe(-300)
    // the first at $1,500 is $500 over at once; the second at $200 brings the end to $700 over: $200 more.
    expect(allowanceMath(1000, [m('selected', 1500), m('pending', null)]).chargeFor('selected1500', 1500)).toBe(500)
    expect(allowanceMath(1000, [m('approved', 1500, 500), m('selected', 200)]).chargeFor('selected200', 200)).toBe(200)
  })
})

describe('shared allowances', () => {
  test('is registered, not ready, and the general contractor’s', () => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'shared_allowances')
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm']])
  })

  test('one allowance over three selections: no charge while under, the overage raised and linked when the last goes over', async () => {
    const x = await boot()
    const faucet = await x.selection('Faucet'), sinks = await x.selection('Sinks', 2), tub = await x.selection('Tub')
    const made = await x.owner(`/api/selections/project/${x.bath.id}/allowances`, { method: 'POST', json: { name: 'Plumbing fixtures', amount: 4000, costCode: '15-Plumbing', selectionIds: [faucet.id, sinks.id, tub.id] } })
    expect(made.status).toBe(201)
    expect(await json(made)).toMatchObject({ name: 'Plumbing fixtures', amount: 4000, chosen: 0, remaining: 4000, openSelections: 3 })

    const f900 = await x.option('Brushed faucet', 900, 520), s700 = await x.option('Undermount sink', 700, 410), t2500 = await x.option('Soaking tub', 2500, 1700)
    expect((await x.choose(faucet.id, f900.id)).priceDifference).toBe('0.00')
    expect((await x.approve(faucet.id)).changeOrder).toBeNull()
    await x.choose(sinks.id, s700.id)
    expect((await x.approve(sinks.id)).changeOrder).toBeNull()
    // 900 + 1,400 + 2,500 = 4,800 against 4,000: the tub is charged the 800
    const list = await json(await x.owner(`/api/selections/project/${x.bath.id}`))
    await x.choose(tub.id, t2500.id)
    const listed = (await json(await x.owner(`/api/selections/project/${x.bath.id}`))).data.find((s: any) => s.id === tub.id)
    expect(listed).toMatchObject({ priceDifference: 800, isUpgrade: true, sharedAllowance: { name: 'Plumbing fixtures', amount: 4000 } })
    expect(list.data.length).toBe(3)
    const done = await x.approve(tub.id)
    expect(Number(done.changeOrder.amount)).toBe(800)
    const [row] = await x.t.db.select().from(x.t.schema.projectSelection).where(eq(x.t.schema.projectSelection.id, tub.id)) as any[]
    expect(row.changeOrderId).toBe(done.changeOrder.id)

    const summary = await json(await x.owner(`/api/selections/project/${x.bath.id}/summary`))
    expect(summary.totalAllowance).toBe(4000) // once, not once per selection
    const [a] = (await json(await x.owner(`/api/selections/project/${x.bath.id}/allowances`))).data
    expect(a).toMatchObject({ chosen: 4800, over: 800, raised: 800, openSelections: 0 })
    // an approved member keeps its allowance: no moving it, no deleting the allowance, no changing the amount
    expect((await x.owner(`/api/selections/${tub.id}/allowance`, { method: 'PUT', json: { allowanceId: null } })).status).toBe(400)
    expect((await x.owner(`/api/selections/allowances/${a.id}`, { method: 'DELETE' })).status).toBe(400)
    expect((await x.owner(`/api/selections/allowances/${a.id}`, { method: 'PUT', json: { amount: 5000 } })).status).toBe(400)
  }, 90_000)

  test('the revised budget: the overage on the allowance’s cost code at the chosen cost, other approved change orders beside it', async () => {
    const x = await boot()
    const vanity = await x.selection('Vanity'), mirror = await x.selection('Mirror')
    await x.owner(`/api/selections/project/${x.bath.id}/allowances`, { method: 'POST', json: { name: 'Vanity wall', amount: 1000, costCode: '12-Cabinets', selectionIds: [vanity.id, mirror.id] } })
    const v = await x.option('Oak vanity', 1500, 900), m = await x.option('Round mirror', 200, 90)
    await x.choose(vanity.id, v.id); expect(Number((await x.approve(vanity.id)).changeOrder.amount)).toBe(500)
    await x.choose(mirror.id, m.id); expect(Number((await x.approve(mirror.id)).changeOrder.amount)).toBe(200)
    // the selections' change orders approved, and one of the office's own
    await x.t.db.update(x.t.schema.changeOrder).set({ status: 'approved' } as any).where(eq(x.t.schema.changeOrder.projectId, x.bath.id))
    await x.ins(x.t.schema.changeOrder, { companyId: x.companyId, projectId: x.bath.id, number: 'CO-009', title: 'Add a niche', amount: '300', status: 'approved' })
    const b = await json(await x.owner(`/api/job-costing/budget/${x.bath.id}`))
    const by = Object.fromEntries(b.revisions.map((r: any) => [r.costCode, r]))
    expect(by['12-Cabinets']).toMatchObject({ priceChange: 700, costChange: 990 })
    expect(by['Change orders']).toMatchObject({ priceChange: 300, costChange: 0 })
    expect([b.revisedTotalPrice, b.revisedTotalCost]).toEqual([1000, 990]) // no quote: the original is 0
    // WIP: the selection change orders count once, as approved change orders
    const wip = (await json(await x.owner('/api/wip'))).rows.find((r: any) => r.id === x.bath.id)
    expect([wip.approvedChanges, wip.selectionChanges]).toEqual([1000, 0])
  }, 90_000)

  test('WIP: a selection approved without a change order still changes the contract value', async () => {
    const x = await boot()
    const tile = await x.selection('Floor tile', 1, { allowance: '600' })
    const o = await x.option('Marble tile', 950, 500)
    await x.choose(tile.id, o.id)
    expect((await x.approve(tile.id, false)).changeOrder).toBeNull()
    await x.ins(x.t.schema.project, { companyId: x.companyId, number: 'PRJ-0002', name: 'Other', status: 'active', estimatedValue: '10' })
    await x.t.db.update(x.t.schema.project).set({ estimatedValue: '20000' } as any).where(eq(x.t.schema.project.id, x.bath.id))
    const wip = (await json(await x.owner('/api/wip'))).rows.find((r: any) => r.id === x.bath.id)
    expect([wip.contractValue, wip.selectionChanges]).toEqual([20350, 350])
  }, 90_000)

  test('off: no allowance routes, no revised budget, WIP and pricing as they were', async () => {
    const x = await boot(BASE)
    const tile = await x.selection('Floor tile', 1, { allowance: '600' })
    expect((await x.owner(`/api/selections/project/${x.bath.id}/allowances`)).status).toBe(404)
    expect((await x.owner(`/api/selections/${tile.id}/allowance`, { method: 'PUT', json: { allowanceId: null } })).status).toBe(404)
    // the rest of /api/selections is untouched by the allowance routes' gate
    expect((await x.owner(`/api/selections/project/${x.bath.id}`)).status).toBe(200)
    const o = await x.option('Marble tile', 950, 500)
    expect(Number((await x.choose(tile.id, o.id)).priceDifference)).toBe(350)
    const b = await json(await x.owner(`/api/job-costing/budget/${x.bath.id}`))
    expect(b.revisions).toBeUndefined()
    await x.approve(tile.id, false)
    await x.t.db.update(x.t.schema.project).set({ estimatedValue: '20000' } as any).where(eq(x.t.schema.project.id, x.bath.id))
    const wip = (await json(await x.owner('/api/wip'))).rows.find((r: any) => r.id === x.bath.id)
    expect(wip.contractValue).toBe(20000)
    expect('selectionChanges' in wip).toBe(false)
  }, 90_000)
})
