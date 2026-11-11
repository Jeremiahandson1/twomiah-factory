// Parity tier 3 (11/10, contractor): bid packages to subs — Buildertrend's bid requests, on the vendor portal and purchase orders.
// Through the real server as the contractor:
//   · a package on a project with the items to price and the subs invited; sent, each sub gets their portal link by email;
//   · in the portal the sub sees it (marked seen), prices every item and sends, or declines; a part-priced bid is refused;
//   · the office compares line by line and awards one: the winner's purchase order is drafted from their prices, the rest lost;
//   · a sub never sees another's request; a draft is not shown; switched off, closed in the office and the portal.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { bidTotal } from '../server/crm/projects/bidPackages.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', proj = '', frameCo = '', buildCo = '', pkg = ''
const mails: any[] = []
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const FEATURES = ['contacts', 'projects', 'purchase_orders', 'vendor_portal', 'bid_packages']
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const tokenOf = async (id: string) => ((await (t.db as any).select({ tk: t.schema.contact.portalToken }).from(t.schema.contact).where(eq(t.schema.contact.id, id)))[0].tk as string)
const portal = async (id: string, path = '', init: any = {}) => json(await t.call(`/api/vendor-portal/v/${await tokenOf(id)}${path}`, init))

beforeAll(async () => {
  process.env.FRONTEND_URL = 'https://crm.builder.example'
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(FEATURES)
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  proj = ((await (t.db as any).insert(t.schema.project).values({ companyId, number: 'PRJ-1', name: 'New house' }).returning())[0]).id
  const sub = async (name: string, email: string) => ((await (t.db as any).insert(t.schema.contact).values({ companyId, name, company: name, type: 'subcontractor', email }).returning())[0]).id
  frameCo = await sub('Frame Co', 'bids@frameco.example')
  buildCo = await sub('Build Co', 'office@buildco.example')
}, 120_000)

test('a bid total is each item × the price asked', () => {
  expect(bidTotal([{ id: 'a', description: 'Walls', quantity: 2, unit: null }, { id: 'b', description: 'Roof', quantity: 1, unit: null }], [{ lineId: 'a', unitPrice: 1000 }, { lineId: 'b', unitPrice: 2500.5 }])).toBe(4500.5)
})

test('made on a project, then sent: each sub is emailed their link; a draft is not in their portal', async () => {
  const r = await json(await call('/api/bid-packages', { method: 'POST', json: { projectId: proj, title: 'Framing', scope: 'Frame the house per plans.', dueDate: '2026-12-01', lines: [{ description: 'Walls', quantity: 2, unit: 'floors' }, { description: 'Roof framing', quantity: 1 }], vendorIds: [frameCo, buildCo] } }))
  expect(r.status).toBe(201)
  pkg = r.body.id
  expect(r.body.bids.map((b: any) => b.status)).toEqual(['invited', 'invited'])
  // The sub's portal link exists only once it was sent (ensureVendorLink); a draft shows nothing either way.
  const sent = await json(await call(`/api/bid-packages/${pkg}/send`, { method: 'POST', json: {} }))
  expect([sent.body.status, sent.body.emailed]).toEqual(['open', 2])
  expect(mails.map((m) => m.to).sort()).toEqual(['bids@frameco.example', 'office@buildco.example'])
  expect(mails[0].html).toContain('https://crm.builder.example/')
  // The office can copy a sub's link to send another way — the same link the email carried (live test 11/11).
  const inv = sent.body.bids[0].id
  const link = await json(await call(`/api/bid-packages/${pkg}/invites/${inv}/link`, { method: 'POST', json: {} }))
  expect(link.status).toBe(200)
  expect(mails.some((m) => m.html.includes(link.body.link))).toBe(true)
  expect((await call(`/api/bid-packages/${pkg}/invites/nope/link`, { method: 'POST', json: {} })).status).toBe(404)
})

test('in the portal: seen, priced and sent; a part-priced bid refused; the other declines', async () => {
  const seen = await portal(frameCo)
  expect(seen.status).toBe(200)
  const req = seen.body.bidRequests.find((x: any) => x.title === 'Framing')
  expect(req.status).toBe('viewed')
  const [walls, roof] = req.lines
  expect((await portal(frameCo, `/bids/${req.id}`, { method: 'POST', json: { prices: [{ lineId: walls.id, unitPrice: 9000 }] } })).status).toBe(400)
  const ok = await portal(frameCo, `/bids/${req.id}`, { method: 'POST', json: { prices: [{ lineId: walls.id, unitPrice: 9000 }, { lineId: roof.id, unitPrice: 6000 }], notes: 'Two weeks' } })
  expect([ok.status, ok.body.status, ok.body.total]).toEqual([200, 'submitted', 24000])
  const theirs = (await portal(buildCo)).body.bidRequests[0]
  expect((await portal(buildCo, `/bids/${theirs.id}/decline`, { method: 'POST', json: { reason: 'Booked up' } })).status).toBe(200)
  // One sub's request id is nothing to another.
  expect((await portal(buildCo, `/bids/${req.id}`, { method: 'POST', json: { prices: [] } })).status).toBe(404)
})

test('the office compares and awards: the winner\'s purchase order is drafted from their prices', async () => {
  const v = await json(await call(`/api/bid-packages/${pkg}`))
  const frame = v.body.bids.find((b: any) => b.vendor === 'Frame Co')
  expect(frame).toMatchObject({ status: 'submitted', total: 24000, notes: 'Two weeks' })
  expect(v.body.bids.find((b: any) => b.vendor === 'Build Co')).toMatchObject({ status: 'declined', declinedReason: 'Booked up' })
  const declined = v.body.bids.find((b: any) => b.vendor === 'Build Co')
  expect((await call(`/api/bid-packages/${pkg}/award`, { method: 'POST', json: { inviteId: declined.id } })).status).toBe(400)
  const a = await json(await call(`/api/bid-packages/${pkg}/award`, { method: 'POST', json: { inviteId: frame.id } }))
  expect(a.status).toBe(200)
  expect(a.body.status).toBe('awarded')
  const [po] = await (t.db as any).select().from(t.schema.jobPurchaseOrder).where(eq(t.schema.jobPurchaseOrder.id, a.body.purchaseOrder.id))
  expect([po.status, po.vendorId, Number(po.total), po.projectId]).toEqual(['draft', frameCo, 24000, proj])
  const lines = await (t.db as any).select().from(t.schema.jobPurchaseOrderLine).where(eq(t.schema.jobPurchaseOrderLine.purchaseOrderId, po.id))
  expect(lines.map((l: any) => [l.description, Number(l.quantity), Number(l.unitCost), Number(l.total)]).sort()).toEqual([['Roof framing', 1, 6000, 6000], ['Walls (floors)', 2, 9000, 18000]])
  expect((await call(`/api/bid-packages/${pkg}/award`, { method: 'POST', json: { inviteId: frame.id } })).status).toBe(400)
})

test('switched off: closed in the office, and the portal carries no bid requests', async () => {
  await setFeatures(['contacts', 'projects', 'purchase_orders', 'vendor_portal'])
  try {
    expect([403, 404]).toContain((await call(`/api/bid-packages/${pkg}`)).status)
    const p = await portal(frameCo)
    expect(p.body.bidRequests).toBeUndefined()
    expect((await portal(frameCo, '/bids/anything', { method: 'POST', json: {} })).status).toBe(404)
  } finally { await setFeatures(FEATURES) }
})
