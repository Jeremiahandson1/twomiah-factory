// Roofing parity row 26 — work orders from the proposal, scope templates, CompanyCam to the account step (Roofr Work Orders 2.0;
// data/workOrderTools.ts, crm/roof/workOrders.ts; work_order_tools, not ready). The measurement report on the crew's page is NOT
// built (roof reports are the owner's own software, not ready — owner, 11/06). Fails without the change.
import { describe, test, expect, beforeAll, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { useCompanyCamForTests } from '../server/data/workOrderTools.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const ins = async (table: any, v: any) => ((await t.db.insert(table).values(v).returning()) as any[])[0]
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'quotes', 'roof_work_orders', ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(['work_order_tools'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
}, 120_000)
afterEach(() => useCompanyCamForTests(null))

describe('row 26', () => {
  test('from the signed proposal: every agreed line (labour and other too) as the scope, the material lines, never a price', async () => {
    const ct = await ins(t.schema.contact, { companyId, name: 'Lee Marsh', type: 'client' })
    const j = await ins(t.schema.job, { companyId, number: 'J-77', title: 'Re-roof', contactId: ct.id })
    expect((await auth(`/api/work-orders/from-proposal?jobId=${j.id}`)).status).toBe(404) // no signed proposal yet
    const q = await ins(t.schema.quote, { companyId, contactId: ct.id, jobId: j.id, number: 'Q-9', name: 'Re-roof', status: 'approved', approvedAt: new Date(), subtotal: '0', total: '0' })
    await t.db.insert(t.schema.quoteLineItem).values([
      { quoteId: q.id, description: 'Tear off one layer', type: 'labor', quantity: '30', unitPrice: '55', total: '1650', sortOrder: 0 },
      { quoteId: q.id, description: 'Architectural shingles', type: 'material', quantity: '32', unitPrice: '120', total: '3840', sortOrder: 1 },
      { quoteId: q.id, description: 'Haul-off', type: 'other', quantity: '1', unitPrice: '300', total: '300', sortOrder: 2 },
      { quoteId: q.id, description: 'Gutter guards (not chosen)', type: 'service', quantity: '1', unitPrice: '900', total: '900', optional: true, selected: false, sortOrder: 3 },
    ] as any)
    const r = await json(await auth(`/api/work-orders/from-proposal?jobId=${j.id}`))
    expect(r.status).toBe(200)
    expect(r.body.scope).toBe('From signed proposal Q-9 — Re-roof:\n• Tear off one layer × 30\n• Architectural shingles × 32\n• Haul-off')
    expect(r.body.materialLines).toEqual([{ description: 'Architectural shingles', qty: 32, unit: 'ea' }])
    expect(JSON.stringify(r.body)).not.toMatch(/1650|3840|120|unitPrice|total/)
  })

  test('scope templates: saved, listed, deleted', async () => {
    const made = await json(await auth('/api/work-orders/templates', { method: 'POST', json: { name: 'Standard tear-off', scope: 'Tarp the landscaping.\nMagnet sweep twice.' } }))
    expect(made.status).toBe(201)
    expect((await auth('/api/work-orders/templates', { method: 'POST', json: { name: '', scope: 'x' } })).status).toBe(400)
    const list = await json(await auth('/api/work-orders/templates'))
    expect(list.body.data.map((x: any) => x.name)).toEqual(['Standard tear-off'])
    expect((await auth(`/api/work-orders/templates/${made.body.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  test('CompanyCam: no account → said plainly; connected → its photos for the job', async () => {
    const ct = await ins(t.schema.contact, { companyId, name: 'Cam Photo', type: 'client' })
    const j = await ins(t.schema.job, { companyId, number: 'J-78', title: 'Repair', contactId: ct.id, address: '9 Oak' })
    const none = await json(await auth(`/api/work-orders/companycam-photos?jobId=${j.id}`))
    expect([none.status, none.body.code]).toEqual([501, 'NO_ACCOUNT'])
    let asked: any = null
    useCompanyCamForTests({ name: 'CompanyCam', photos: async (ref) => { asked = ref; return [{ id: 'cc1', url: 'https://img.example/1.jpg', capturedAt: null, caption: 'Ridge' }] } })
    const got = await json(await auth(`/api/work-orders/companycam-photos?jobId=${j.id}`))
    expect(got.body.data.map((p: any) => p.id)).toEqual(['cc1'])
    expect(asked).toEqual({ address: '9 Oak', jobNumber: 'J-78' })
  })

  test('off: shut; the switch is hidden and roofing’s', async () => {
    await setFeatures([])
    try { expect((await auth('/api/work-orders/templates')).status).toBe(404) } finally { await setFeatures(['work_order_tools']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'work_order_tools') as any
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm-roof']])
  })
})
