// Code review 04 (shared CRM modules), 2026-11-13: vendor bills and loan draws.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
let companyId = ''
let vendorId = ''
let projectId = ''
const call = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any })
const data = (b: any) => b?.data ?? b
/** The business's own calendar day (the seeded company keeps its default zone), n days from today. */
const day = async (n: number) => {
  const [co] = await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, companyId)).limit(1)
  const tz = (co as any).timeZone || (co as any).settings?.timeZone || 'America/Chicago'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'projects', 'jobs', 'purchase_orders', 'vendor_bills', 'draw_schedules'] } as any).where(eq(t.schema.company.id, companyId))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json() as any).accessToken
  const [v] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lumber Yard', type: 'vendor' } as any).returning()
  vendorId = v.id
  const [p] = await t.db.insert(t.schema.project).values({ companyId, name: 'Addition', number: 'P-1' } as any).returning()
  projectId = p.id
}, 120_000)

describe('04-1: a bill is overdue when its due day is over', () => {
  test('due today is not overdue; due yesterday is', async () => {
    const dueToday = await json(await call('/api/bills', { method: 'POST', json: { vendorId, amount: 50, dueDate: await day(0) } }))
    const dueYesterday = await json(await call('/api/bills', { method: 'POST', json: { vendorId, amount: 60, dueDate: await day(-1) } }))
    expect(dueToday.status).toBe(201)
    const overdue = await json(await call('/api/bills?status=overdue'))
    const ids = (overdue.body.data as any[]).map((b) => b.id)
    expect(ids).toContain(data(dueYesterday.body).id)
    expect(ids).not.toContain(data(dueToday.body).id)
    expect(data((await json(await call('/api/bills/summary'))).body).overdueCount).toBe(1)
  })
})

describe('04-2: a purchase order is billed when bills cover it', () => {
  test('paying a small bill in full does not close the order; covering it does; a void bill stays void', async () => {
    const po = await json(await call('/api/purchase-orders', { method: 'POST', json: { vendorId, projectId, lines: [{ description: 'Studs', quantity: 100, unitCost: 10 }] } }))
    expect(po.status).toBe(201)
    const poId = data(po.body).id
    expect((await call(`/api/purchase-orders/${poId}/send`, { method: 'POST' })).status).toBe(200)
    const small = data((await json(await call('/api/bills', { method: 'POST', json: { vendorId, amount: 100, purchaseOrderId: poId } }))).body)
    expect((await call(`/api/bills/${small.id}/record-payment`, { method: 'POST', json: { amount: 100 } })).status).toBe(200)
    const [after] = await t.db.select().from(t.schema.jobPurchaseOrder).where(eq(t.schema.jobPurchaseOrder.id, poId))
    expect(after.status).not.toBe('billed')
    // The rest billed: the order is billed (the bill's own creation rule).
    expect((await call('/api/bills', { method: 'POST', json: { vendorId, amount: 900, purchaseOrderId: poId } })).status).toBe(201)
    const [covered] = await t.db.select().from(t.schema.jobPurchaseOrder).where(eq(t.schema.jobPurchaseOrder.id, poId))
    expect(covered.status).toBe('billed')
    // Void, then an edit: refused.
    const b = data((await json(await call('/api/bills', { method: 'POST', json: { vendorId, amount: 40 } }))).body)
    expect((await call(`/api/bills/${b.id}/void`, { method: 'POST' })).status).toBe(200)
    expect((await call(`/api/bills/${b.id}`, { method: 'PUT', json: { amount: 45 } })).status).toBe(400)
  })
})

describe('04-3: draws on one loan are taken one at a time', () => {
  test('two requests at once get two numbers and cannot together pass the loan', async () => {
    const s = data((await json(await call('/api/draw-schedules', { method: 'POST', json: { projectId, totalAmount: 1000, retainagePercent: 10 } }))).body)
    const ask = () => call('/api/draw-schedules/requests', { method: 'POST', json: { scheduleOfValuesId: s.id, grossAmount: 600 } })
    const both = await Promise.all([ask(), ask()])
    expect(both.map((r) => r.status).sort()).toEqual([201, 400])
    const next = await json(await call('/api/draw-schedules/requests', { method: 'POST', json: { scheduleOfValuesId: s.id, grossAmount: 400 } }))
    expect(next.status).toBe(201)
    expect(data(next.body).drawNumber).toBe(2)
    expect(data(next.body).netAmount).toBe('360.00')
  })
})
