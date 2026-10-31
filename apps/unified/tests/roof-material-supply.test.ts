// Sending the material order to the supplier, with the supplier's prices (docs/parity/roof-material-list.md #9, #10, #11), through
// the real server as the roofing vertical. Nothing here sends a real email or reaches a supplier: the shared email sender is
// replaced by a recorder, and a supplier's API is a fake registered for the test.
//   · statuses: Roofr's draft, ready to send, sent, rejected and delivered, beside ordered / partly delivered / cancelled;
//     Sent is set only by sending; an order that is sent is spend, one that is a draft, ready or rejected is not.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const FEATURES = ['jobs', 'contacts', 'materials', 'job_costing', 'roof_material_list', 'material_supply']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any })
const call = async (who: string, method: string, p: string, body?: unknown) => json(await as(who)(p, { method, ...(body === undefined ? {} : { json: body }) }))
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES, email: 'office@test-builders.example', phone: '715-555-0000' } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['mgr', 'manager'], ['rep', 'field'], ['view', 'viewer']] as const) {
    ids[key] = (await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId })).id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  ids.home = (await ins(t.schema.contact, { companyId, name: 'Lee Marsh', mobile: '715-555-0101', type: 'client' })).id
}, 120_000)

async function makeJob(address = '12 Gable Ln') {
  const made = await call('owner', 'POST', '/api/jobs', { contactId: ids.home, jobType: 'retail', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301', totalSquares: 30 })
  expect(made.status).toBe(201)
  return made.body.id as string
}
const order = (jobId: string, extra: Record<string, unknown> = {}, who = 'mgr') =>
  call(who, 'POST', '/api/materials', { jobId, supplier: 'ABC Supply', lineItems: [{ description: 'Shingles', qty: 10, unit: 'bundle', unitPrice: 40 }], ...extra })
/** An order already in a state the API will not set by hand (Sent). */
const raw = (jobId: string, orderStatus: string, price: number, extra: Record<string, unknown> = {}) =>
  ins(t.schema.material, { companyId, jobId, supplier: 'ABC Supply', orderStatus, totalCost: price.toFixed(2), lineItems: [{ description: 'x', qty: 1, unit: 'ea', unitPrice: price, total: price }], ...extra })

describe('statuses', () => {
  test('draft, ready to send, rejected, ordered, partly delivered, delivered and cancelled can be set; Sent only by sending', async () => {
    const jobId = await makeJob()
    for (const s of ['not_ordered', 'ready_to_send', 'rejected', 'ordered', 'partial', 'delivered', 'cancelled']) {
      const r = await order(jobId, { orderStatus: s })
      expect([s, r.status, r.body.orderStatus]).toEqual([s, 201, s])
    }
    const made = await order(jobId, { orderStatus: 'ready_to_send' })
    const hand = await call('mgr', 'PUT', `/api/materials/${made.body.id}`, { orderStatus: 'sent' })
    expect([hand.status, hand.body.code, Object.keys(hand.body.fields)]).toEqual([400, 'status_sent_by_sending', ['orderStatus']])
    expect((await order(jobId, { orderStatus: 'sent' })).status).toBe(400)
    expect((await call('mgr', 'PUT', `/api/materials/${made.body.id}`, { orderStatus: 'shipped' })).status).toBe(400)
    // An order that really was sent can be edited without losing its Sent.
    const sent = await raw(jobId, 'sent', 500)
    const edited = await call('mgr', 'PUT', `/api/materials/${sent.id}`, { orderStatus: 'sent', notes: 'Call the yard first' })
    expect([edited.status, edited.body.orderStatus, edited.body.notes]).toEqual([200, 'sent', 'Call the yard first'])
    const filtered = await call('mgr', 'GET', `/api/materials?status=ready_to_send&jobId=${jobId}`)
    expect(filtered.body.data.every((o: any) => o.status === 'ready_to_send')).toBe(true)
    expect(filtered.body.data.length).toBe(2)
  })

  test('a sent order is spend on the job; a draft, a ready one and a rejected one are not', async () => {
    const jobId = await makeJob('3 Spend St')
    await raw(jobId, 'sent', 1000)
    await raw(jobId, 'ordered', 100)
    for (const [s, price] of [['not_ordered', 200], ['ready_to_send', 500], ['rejected', 300], ['cancelled', 50]] as const) await raw(jobId, s, price)
    const costing = await call('owner', 'GET', `/api/job-costing/job/${jobId}`)
    expect(costing.status).toBe(200)
    expect(costing.body.roof.materialOrderCost).toBe(1100)
  })
})
