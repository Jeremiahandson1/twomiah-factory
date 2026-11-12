// Roofing parity row 27 — work order send options (Roofr + AccuLynx; crm/roof/workOrders.ts, crewLink.ts; work_order_send_options, not
// ready). Fails without the change.
//   · email with CC as well as text; the crew page in Spanish with the office's Spanish scope (the page's own words are translated
//     on the page; no paid translation service is used);
//   · approval switched off per crew and per order: the order is accepted on send;
//   · the sub's view: the link's days, materials and photos hidden when the office says so;
//   · off: the options route is shut and sending is as before.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
let jobId = ''
const mails: any[] = []
const saved: Record<string, string | undefined> = {}
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const ins = async (table: any, v: any) => ((await t.db.insert(table).values(v).returning()) as any[])[0]
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'roof_work_orders', 'crews', ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const order = async (extra: any = {}) => {
  const r = await json(await auth('/api/work-orders', { method: 'POST', json: { jobId, title: 'Tear-off', scope: 'Tear off and dry in.', recipientName: 'Carlos', recipientPhone: '715-555-0199', materialLines: [{ description: 'Shingles', qty: 30, unit: 'sq' }], ...extra } }))
  expect(r.status).toBe(201)
  return r.body
}
const tokenOf = async (id: string) => (await t.db.select().from(t.schema.workOrder).where(eq(t.schema.workOrder.id, id)))[0].publicToken as string

beforeAll(async () => {
  saved.FRONTEND_URL = process.env.FRONTEND_URL
  process.env.FRONTEND_URL = 'https://app.roofer.example'
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(['work_order_send_options'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
  const ct = await ins(t.schema.contact, { companyId, name: 'Lee', type: 'client' })
  jobId = (await ins(t.schema.job, { companyId, number: 'J-1', title: 'Roof', contactId: ct.id, address: '1 Oak' })).id
}, 120_000)

describe('row 27', () => {
  test('email with CC, in Spanish: the message and the crew page are Spanish, the office’s Spanish scope is shown', async () => {
    const o = await order()
    const opt = await auth(`/api/work-orders/${o.id}/options`, { method: 'PUT', json: { recipientEmail: 'carlos@crew.example', ccEmails: ['office@sub.example'], language: 'es', scopeEs: 'Quitar el techo y secar.' } })
    expect(opt.status).toBe(200)
    expect((await auth(`/api/work-orders/${o.id}/options`, { method: 'PUT', json: { ccEmails: ['not-an-email'] } })).status).toBe(400)
    mails.length = 0
    const sent = await json(await auth(`/api/work-orders/${o.id}/send`, { method: 'POST', json: { channel: 'email' } }))
    expect(sent.body.emailed).toBe(2)
    expect(mails.map((m) => m.to)).toEqual(['carlos@crew.example', 'office@sub.example'])
    expect(mails[0].subject).toBe('Orden de trabajo: Tear-off')
    expect(mails[0].html).toContain('Vea los detalles y acepte o rechace')
    const page = await json(await t.call(`/api/crew-link/${await tokenOf(o.id)}`))
    expect(page.body).toMatchObject({ language: 'es', scope: 'Quitar el techo y secar.' })
  })

  test('approval off for the crew, or the order: accepted when sent; the order’s own answer wins', async () => {
    const cr = await ins(t.schema.crew, { companyId, name: 'Sub A', foremanName: 'Ana', foremanPhone: '715-555-0198', size: 3 })
    expect((await auth(`/api/work-orders/crew-approval/${cr.id}`, { method: 'PUT', json: { requiresApproval: false } })).status).toBe(200)
    const o = await order({ crewId: cr.id })
    await auth(`/api/work-orders/${o.id}/options`, { method: 'PUT', json: { recipientEmail: 'ana@sub.example' } })
    const sent = await json(await auth(`/api/work-orders/${o.id}/send`, { method: 'POST', json: { channel: 'email' } }))
    expect(sent.body.status).toBe('accepted')
    const page = await json(await t.call(`/api/crew-link/${await tokenOf(o.id)}`))
    expect(page.body.can).toMatchObject({ accept: false, complete: true })
    // The order asks even though the crew does not.
    const o2 = await order({ crewId: cr.id })
    await auth(`/api/work-orders/${o2.id}/options`, { method: 'PUT', json: { requiresApproval: true, recipientEmail: 'ana@sub.example' } })
    expect((await json(await auth(`/api/work-orders/${o2.id}/send`, { method: 'POST', json: { channel: 'email' } }))).body.status).toBe('sent')
  })

  test('the sub’s view: materials and photos hidden; the link lasts the office’s days', async () => {
    const o = await order()
    await auth(`/api/work-orders/${o.id}/options`, { method: 'PUT', json: { showMaterials: false, showPhotos: false, linkDays: 3, recipientEmail: 'x@crew.example' } })
    await auth(`/api/work-orders/${o.id}/send`, { method: 'POST', json: { channel: 'email' } })
    const row = (await t.db.select().from(t.schema.workOrder).where(eq(t.schema.workOrder.id, o.id)))[0]
    const days = (new Date(row.tokenExpiresAt as any).getTime() - new Date(row.sentAt as any).getTime()) / 86_400_000
    expect(Math.round(days)).toBe(3)
    const page = await json(await t.call(`/api/crew-link/${row.publicToken}`))
    expect([page.body.materials, page.body.photos]).toEqual([[], []])
  })

  test('off: the options route is shut, the page is English as before; the switch is hidden and roofing’s', async () => {
    const o = await order()
    await setFeatures([])
    try {
      expect((await auth(`/api/work-orders/${o.id}/options`, { method: 'PUT', json: { language: 'es' } })).status).toBe(404)
    } finally { await setFeatures(['work_order_send_options']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'work_order_send_options') as any
    expect([!!f?.hidden, f?.templates]).toEqual([false, ['crm-roof']])
    if (saved.FRONTEND_URL === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = saved.FRONTEND_URL
  })
})
