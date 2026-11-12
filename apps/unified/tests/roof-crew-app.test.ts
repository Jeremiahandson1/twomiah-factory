// Roofing parity row 29 — the crew's work orders in the phone app (AccuLynx Crew App; crm/roof/crewOrders.ts; crew_app, not ready).
// Fails without the change: /api/crew-orders did not exist.
//   · a seat on a crew (its crew login) sees that crew's open work orders and none of another crew's;
//   · each comes as the crew page shows it, keyed by its token, with the page's link for photos;
//   · the phone answers through the crew link's own routes, so the order moves the one way it always does;
//   · a finished order stays a week; a seat on no crew sees none; off: 404, and the switch is hidden and roofing's.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
let ownerId = ''
let jobId = ''
let mine = ''
let theirs = ''
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const ins = async (table: any, v: any) => ((await t.db.insert(table).values(v).returning()) as any[])[0]
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'roof_work_orders', 'crews', ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const sentOrder = async (crewId: string, title: string) => {
  const o = (await json(await auth('/api/work-orders', { method: 'POST', json: { jobId, crewId, title, startDate: '2026-11-20' } }))).body
  await auth(`/api/work-orders/${o.id}/send`, { method: 'POST', json: {} })
  const row = (await t.db.select().from(t.schema.workOrder).where(eq(t.schema.workOrder.id, o.id)))[0]
  return { id: o.id as string, token: row.publicToken as string }
}

beforeAll(async () => {
  process.env.FRONTEND_URL = 'https://app.roofer.example'
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  ownerId = s.owner.id
  await setFeatures(['crew_app'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  ;(t.services as any).crm.sms.sendSMS = async () => ({ success: true })
  ;(t.services.crm.emailService as any).sendRaw = async () => ({ success: true })
  const ct = await ins(t.schema.contact, { companyId, name: 'Lee', type: 'client' })
  jobId = (await ins(t.schema.job, { companyId, number: 'J-1', title: 'Roof', contactId: ct.id, address: '1 Oak St' })).id
  mine = (await ins(t.schema.crew, { companyId, name: 'Crew A', foremanName: 'Carlos', foremanPhone: '715-555-0199', size: 3 })).id
  theirs = (await ins(t.schema.crew, { companyId, name: 'Crew B', foremanName: 'Bo', foremanPhone: '715-555-0197', size: 2 })).id
}, 120_000)

describe('row 29: the crew app', () => {
  test('a seat on no crew sees none', async () => {
    await sentOrder(mine, 'Before')
    const r = await json(await auth('/api/crew-orders'))
    expect(r.status).toBe(200)
    expect(r.body.data).toEqual([])
  })

  test('a seat on a crew sees its crew’s orders, as the crew page shows them, and none of another crew’s', async () => {
    await ins(t.schema.crewLogin, { companyId, userId: ownerId, crewId: mine })
    const a = await sentOrder(mine, 'Tear-off')
    const b = await sentOrder(theirs, 'Gutters')
    const list = await json(await auth('/api/crew-orders'))
    const ids = list.body.data.map((x: any) => x.id)
    expect(ids).toContain(a.token)
    expect(ids).not.toContain(b.token)
    const one = list.body.data.find((x: any) => x.id === a.token)
    expect(one).toMatchObject({ title: 'Tear-off', status: 'sent' })
    expect(one.linkUrl).toBe(`https://app.roofer.example/w/${a.token}`)
    expect(one.can.accept).toBe(true)
    expect(JSON.stringify(one)).not.toMatch(/Lee/)
    expect((await auth(`/api/crew-orders/${b.token}`)).status).toBe(404)
    expect((await json(await auth(`/api/crew-orders/${a.token}`))).body.id).toBe(a.token)
  })

  test('answered through the crew link: accepted, then done; a finished one stays in the list', async () => {
    const a = await sentOrder(mine, 'Ridge')
    expect((await t.call(`/api/crew-link/${a.token}/accept`, { method: 'POST', json: { name: 'Carlos Ruiz' } })).status).toBe(200)
    expect((await json(await auth(`/api/crew-orders/${a.token}`))).body.status).toBe('accepted')
    expect((await t.call(`/api/crew-link/${a.token}/complete`, { method: 'POST', json: { note: 'Done' } })).status).toBe(200)
    const after = (await json(await auth('/api/crew-orders'))).body.data.find((x: any) => x.id === a.token)
    expect(after?.status).toBe('completed')
    await t.db.update(t.schema.workOrder).set({ completedAt: new Date('2026-01-01') } as any).where(eq(t.schema.workOrder.id, a.id))
    expect((await json(await auth('/api/crew-orders'))).body.data.map((x: any) => x.id)).not.toContain(a.token)
  })

  test('off: 404; the switch is hidden and roofing’s', async () => {
    await setFeatures([])
    try {
      expect((await auth('/api/crew-orders')).status).toBe(404)
    } finally { await setFeatures(['crew_app']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'crew_app') as any
    expect([!!f?.hidden, f?.templates]).toEqual([false, ['crm-roof']])
  })
})
