// Parity tier 2 #4 (11/10): change orders on a JOB (ServiceTitan's change orders on a service call), through the real server as
// field service:
//   · raised on a job of this business (a project or a job, never both, never another business's);
//   · sent to the customer (their portal lists it with the job's name) and approved;
//   · billed as its own line on the job's invoice, once — with the job's price, or alone when the job has none;
//   · behind job_change_orders (or the contractor's change_orders): neither on, the routes are closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', hank = '', jobId = '', bareJobId = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const ON = ['jobs', 'contacts', 'quotes', 'invoices', 'client_portal', 'job_change_orders']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await features(ON)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  hank = (await ins(t.schema.contact, { companyId, name: 'Hank Homeowner', email: 'hank@home.example', type: 'client', portalEnabled: true, portalToken: 'hank-co' })).id
  jobId = (await ins(t.schema.job, { companyId, contactId: hank, number: 'JOB-00991', title: 'Furnace replacement', status: 'completed', estimatedValue: '4600' })).id
  bareJobId = (await ins(t.schema.job, { companyId, contactId: hank, number: 'JOB-00992', title: 'Thermostat swap', status: 'completed' })).id
}, 120_000)

test('job_change_orders is registered, not ready, for the trades that bill a job', () => {
  const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'job_change_orders')
  expect([f.hidden, f.templates]).toEqual([true, ['crm-fieldservice', 'crm-landscaping']])
})

test("a change order is for a project or a job of this business — one, never both, never another's", async () => {
  expect((await call('/api/change-orders', { method: 'POST', json: { title: 'X', amount: 10 } })).status).toBe(400)
  expect((await call('/api/change-orders', { method: 'POST', json: { title: 'X', amount: 10, jobId, projectId: 'p1' } })).status).toBe(400)
  expect((await call('/api/change-orders', { method: 'POST', json: { title: 'X', amount: 10, jobId: 'not-a-job' } })).status).toBe(404)
})

test("raised, sent (the customer's portal lists it by the job), approved — then billed once on the job's invoice", async () => {
  const co = await json(await call('/api/change-orders', { method: 'POST', json: { jobId, title: 'Add a humidifier', description: 'Whole-house bypass humidifier', amount: 450 } }))
  expect([co.status, co.body.number, co.body.jobId, co.body.amount]).toEqual([201, 'CO-001', jobId, '450.00'])
  const credit = await json(await call('/api/change-orders', { method: 'POST', json: { jobId, title: 'Reuse the old pad', amount: -50 } }))
  expect(credit.body.number).toBe('CO-002')
  const listed = await json(await call(`/api/change-orders?jobId=${jobId}`))
  expect(listed.body.data.map((r: any) => [r.number, r.job?.number])).toEqual([['CO-002', 'JOB-00991'], ['CO-001', 'JOB-00991']])

  for (const id of [co.body.id, credit.body.id]) {
    expect((await json(await call(`/api/change-orders/${id}/submit`, { method: 'POST', json: {} }))).body.status).toBe('submitted')
  }
  const portal = await json(await t.call('/api/portal/p/hank-co/change-orders'))
  expect(portal.status).toBe(200)
  expect(portal.body.map((r: any) => [r.number, r.jobTitle])).toEqual([['CO-002', 'Furnace replacement'], ['CO-001', 'Furnace replacement']])
  for (const id of [co.body.id, credit.body.id]) {
    expect((await json(await call(`/api/change-orders/${id}/approve`, { method: 'POST', json: {} }))).body.status).toBe('approved')
  }
  // Approving changes no estimate: the change orders are billed as their own lines.
  const [j] = await t.db.select({ v: t.schema.job.estimatedValue }).from(t.schema.job).where(eq(t.schema.job.id, jobId)) as any[]
  expect(Number(j.v)).toBe(4600)

  const inv = await json(await call(`/api/jobs/${jobId}/invoice`, { method: 'POST', json: {} }))
  expect(inv.status).toBe(201)
  const lines = await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, inv.body.id)) as any[]
  expect(lines.map((l) => [l.description, Number(l.unitPrice)])).toEqual([
    ['Furnace replacement (JOB-00991)', 4600], ['Change order CO-001: Add a humidifier', 450], ['Change order CO-002: Reuse the old pad', -50],
  ])
  const after = await json(await call(`/api/change-orders?jobId=${jobId}`))
  expect(after.body.data.every((r: any) => r.invoiceId === inv.body.id)).toBe(true)
  expect((await call(`/api/jobs/${jobId}/invoice`, { method: 'POST', json: {} })).status).toBe(409)
})

test('a job with no price of its own is billed for its approved change orders alone', async () => {
  const co = await json(await call('/api/change-orders', { method: 'POST', json: { jobId: bareJobId, title: 'Smart thermostat', amount: 250 } }))
  await call(`/api/change-orders/${co.body.id}/submit`, { method: 'POST', json: {} })
  await call(`/api/change-orders/${co.body.id}/approve`, { method: 'POST', json: {} })
  const inv = await json(await call(`/api/jobs/${bareJobId}/invoice`, { method: 'POST', json: {} }))
  expect(inv.status).toBe(201)
  const lines = await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, inv.body.id)) as any[]
  expect(lines.map((l) => [l.description, Number(l.unitPrice)])).toEqual([['Change order CO-001: Smart thermostat', 250]])
})

test('neither switch on: the change order routes are closed', async () => {
  await features(['jobs', 'contacts', 'quotes', 'invoices'])
  expect((await call(`/api/change-orders?jobId=${jobId}`)).status).toBe(403)
  await features(ON)
})
